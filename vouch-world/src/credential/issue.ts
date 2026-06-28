// Typed credentials — issue + verify on top of vouch-core.
//
// issueCredential validates the structured claims against the type's schema, then
// hands the universal envelope to vouch-core to sign. verifyCredential does the
// reverse: vouch-core checks the FORM (structure + signature), then this layer
// checks the MEANING (the claims match the declared type).

import { type Certificate, issueCertificate, type VerificationFailureReason, verifyCertificate } from "vouch-core";
import type { CredentialRegistry, CredentialType } from "./types";

export interface IssueCredentialInput<T extends Record<string, unknown>> {
  readonly issuer: string;
  readonly subject: string;
  readonly claims: T;
  readonly issuedAt: string;
  readonly suite?: string;
}

/** Validate the typed claims, then issue + sign the certificate (throws on bad claims). */
export function issueCredential<T extends Record<string, unknown>>(
  type: CredentialType<T>,
  input: IssueCredentialInput<T>,
  issuerPrivateKey: Uint8Array,
): Certificate {
  const claims = type.schema.parse(input.claims); // structured validation; throws if the elements are wrong
  return issueCertificate(
    { issuer: input.issuer, subject: input.subject, schemaId: type.schemaId, claims, issuedAt: input.issuedAt, suite: input.suite },
    issuerPrivateKey,
  );
}

export type CredentialFailureReason = VerificationFailureReason | "schema-mismatch" | "unknown-credential-type" | "invalid-claims";

export type CredentialResult<T> =
  | { readonly ok: true; readonly schemaId: string; readonly claims: T }
  | { readonly ok: false; readonly reason: CredentialFailureReason; readonly detail: string };

function describeClaimIssues(error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> }): string {
  return error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
}

/** Verify FORM (core) then MEANING (claims match `type`). */
export function verifyCredential<T extends Record<string, unknown>>(
  cert: unknown,
  issuerPublicKey: Uint8Array,
  type: CredentialType<T>,
): CredentialResult<T> {
  const form = verifyCertificate(cert, issuerPublicKey);
  if (!form.ok) return { ok: false, reason: form.reason, detail: form.detail };

  const c = cert as Certificate;
  if (c.schemaId !== type.schemaId) {
    return { ok: false, reason: "schema-mismatch", detail: `expected "${type.schemaId}", got "${c.schemaId}"` };
  }
  const parsed = type.schema.safeParse(c.claims);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-claims", detail: describeClaimIssues(parsed.error) };
  }
  return { ok: true, schemaId: c.schemaId, claims: parsed.data };
}

/** Verify against whichever type the registry holds for the cert's `schemaId`. */
export function verifyCredentialWith(
  cert: unknown,
  issuerPublicKey: Uint8Array,
  registry: CredentialRegistry,
): CredentialResult<Record<string, unknown>> {
  const form = verifyCertificate(cert, issuerPublicKey);
  if (!form.ok) return { ok: false, reason: form.reason, detail: form.detail };

  const c = cert as Certificate;
  const type = registry.get(c.schemaId);
  if (!type) {
    return { ok: false, reason: "unknown-credential-type", detail: `no credential type registered for "${c.schemaId}"` };
  }
  const parsed = type.schema.safeParse(c.claims);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-claims", detail: describeClaimIssues(parsed.error) };
  }
  return { ok: true, schemaId: c.schemaId, claims: parsed.data };
}
