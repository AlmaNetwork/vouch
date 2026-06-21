// 第1層 信頼コア — the certificate envelope: generate + formally verify.
//
// This is the heart of the trust core. It does exactly two things (§2-2):
//   1. issueCertificate  — stamp an envelope and sign it with the issuer's key.
//   2. verifyCertificate — check the envelope's SHAPE and SIGNATURE only.
//
// It deliberately does NOT:
//   - decide whether a certificate is "trustworthy"   (that is the village, §2-1)
//   - store certificates                              (stateless, §2-2)
//   - interpret `claims`                              (just a tag + opaque object, §2-3)
//
// Verification takes the issuer's public key as an argument: the core keeps no
// key directory — supplying the key is the caller's (the village's) job.

import { z } from "zod";
import { canonicalBytes } from "./jcs";
import { getSuite } from "./suite";
import { isValidIdentifier } from "./identifier";
import { decodeBase64, encodeBase64 } from "./encoding";

export const CERT_VERSION = "alma-cert/v1";
export const DEFAULT_SUITE = "ed25519";

export interface Certificate {
  readonly version: string; // "alma-cert/v1"
  readonly suite: string; // signature suite id, e.g. "ed25519"
  readonly issuer: string; // name@region
  readonly subject: string; // name@region
  readonly schemaId: string; // opaque schema tag — the core does not interpret it
  readonly claims: Record<string, unknown>; // opaque payload — the core does not interpret it
  readonly issuedAt: string; // ISO 8601, supplied by the caller (no clock in the core, §2-7)
  readonly signature: string; // base64
}

export interface IssueCertificateInput {
  readonly issuer: string;
  readonly subject: string;
  readonly schemaId: string;
  readonly claims: Record<string, unknown>;
  readonly issuedAt: string;
  readonly suite?: string;
}

export type VerificationFailureReason =
  | "malformed-envelope"
  | "invalid-issuer"
  | "invalid-subject"
  | "unknown-suite"
  | "invalid-signature-encoding"
  | "bad-signature";

export type VerificationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: VerificationFailureReason; readonly detail: string };

// --- shared validators ---------------------------------------------------

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIso8601(s: unknown): s is string {
  return typeof s === "string" && ISO8601_RE.test(s) && !Number.isNaN(Date.parse(s));
}

const identifierSchema = z.string().refine(isValidIdentifier, "must be a valid name@region identifier");
const isoSchema = z.string().refine(isIso8601, "must be an ISO 8601 timestamp");
// `claims` stays opaque: validated only as "a plain JSON object", never deeper (§2-2).
const claimsSchema = z.custom<Record<string, unknown>>(isPlainObject, "must be a plain JSON object");

const issueInputSchema = z.object({
  issuer: identifierSchema,
  subject: identifierSchema,
  schemaId: z.string().min(1, "must be a non-empty string"),
  claims: claimsSchema,
  issuedAt: isoSchema,
  suite: z.string().min(1).optional(),
});

const certificateSchema = z.object({
  version: z.literal(CERT_VERSION),
  suite: z.string().min(1),
  issuer: identifierSchema,
  subject: identifierSchema,
  schemaId: z.string().min(1),
  claims: claimsSchema,
  issuedAt: isoSchema,
  signature: z.string(),
});

function fail(reason: VerificationFailureReason, detail: string): VerificationResult {
  return { ok: false, reason, detail };
}

// --- signing payload -----------------------------------------------------

/**
 * The exact unsigned byte payload that gets signed and verified: every field
 * EXCEPT `signature`, JCS-canonicalized. Because JCS sorts keys, the bytes are
 * independent of field order (§M0 determinism test).
 */
export function certificateSigningBytes(cert: Omit<Certificate, "signature">): Uint8Array {
  return canonicalBytes({
    version: cert.version,
    suite: cert.suite,
    issuer: cert.issuer,
    subject: cert.subject,
    schemaId: cert.schemaId,
    claims: cert.claims,
    issuedAt: cert.issuedAt,
  });
}

// --- issue ---------------------------------------------------------------

export function issueCertificate(input: IssueCertificateInput, issuerPrivateKey: Uint8Array): Certificate {
  const parsed = issueInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`alma-core: invalid certificate input — ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`);
  }
  const suiteId = parsed.data.suite ?? DEFAULT_SUITE;
  const suite = getSuite(suiteId);
  if (!suite) {
    throw new Error(`alma-core: unknown signature suite "${suiteId}"`);
  }

  const unsigned: Omit<Certificate, "signature"> = {
    version: CERT_VERSION,
    suite: suiteId,
    issuer: parsed.data.issuer,
    subject: parsed.data.subject,
    schemaId: parsed.data.schemaId,
    claims: parsed.data.claims,
    issuedAt: parsed.data.issuedAt,
  };
  const signature = encodeBase64(suite.sign(certificateSigningBytes(unsigned), issuerPrivateKey));
  return { ...unsigned, signature };
}

// --- verify --------------------------------------------------------------

export function verifyCertificate(cert: unknown, issuerPublicKey: Uint8Array): VerificationResult {
  const parsed = certificateSchema.safeParse(cert);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const head = issue?.path[0];
    if (head === "issuer") return fail("invalid-issuer", issue?.message ?? "invalid issuer");
    if (head === "subject") return fail("invalid-subject", issue?.message ?? "invalid subject");
    const where = issue ? `${issue.path.join(".") || "<root>"}: ${issue.message}` : "invalid certificate envelope";
    return fail("malformed-envelope", where);
  }
  const c = parsed.data;

  const suite = getSuite(c.suite);
  if (!suite) {
    return fail("unknown-suite", `signature suite "${c.suite}" is not registered`);
  }

  let signature: Uint8Array;
  try {
    signature = decodeBase64(c.signature);
  } catch (e) {
    return fail("invalid-signature-encoding", e instanceof Error ? e.message : String(e));
  }

  if (!suite.verify(certificateSigningBytes(c), signature, issuerPublicKey)) {
    return fail("bad-signature", "signature does not verify against the provided issuer public key");
  }
  return { ok: true };
}
