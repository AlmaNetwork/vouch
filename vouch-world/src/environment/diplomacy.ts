// Layer 4 Environment — diplomacy (M4): how a village treats ANOTHER village's
// certificates, and how a founded village joins the international society.
//
// This is the §2-3 form/meaning split in action: vouch-core checks the FORM (the
// signature), and HERE the village applies its MEANING — its diplomacy policy decides
// whether to honor a foreign certificate, translating it into the local vocabulary
// (absorb / map / reexamine / reject, §4-A). The core never gains meaning.

import { type Certificate, decodeBase64, parseIdentifier, verifyCertificate } from "vouch-core";
import { getAgent } from "../agent";
import type { Result } from "../foundation";
import { EVENT_REGION_RECOGNIZED, type ForeignCertStance, getRegion, type RegionState } from "../region";
import { readBackOrThrow, type WorldCommit, type WorldState } from "./state";

/** A village's stance toward another village's certificates: an override, else the default. */
export function stanceToward(viewer: RegionState, issuerRegion: string): ForeignCertStance {
  return viewer.institutions.diplomacyPolicy.overrides[issuerRegion] ?? viewer.institutions.diplomacyPolicy.defaultStance;
}

export type CertAssessment = {
  readonly honored: boolean;
  /** how the certificate was treated */
  readonly stance: "domestic" | ForeignCertStance | "unknown-issuer" | "form-invalid";
  readonly reason: string;
  /** true when accepted via "map" — translated into the viewer's vocabulary */
  readonly mapped: boolean;
};

/** Does the viewer's OWN verification policy accept this schemaId? (domestic + reexamine rule.) */
function acceptsSchema(viewer: RegionState, schemaId: string): boolean {
  const vp = viewer.institutions.verificationPolicy;
  if (vp.acceptedSchemaIds.includes(schemaId)) return true;
  return !vp.rejectUnknownSchemas;
}

/**
 * Assess a certificate from `viewerRegionId`'s viewpoint: verify its FORM via the core,
 * then apply MEANING — domestic certs go by the village's own verification policy;
 * foreign certs go by the diplomacy stance toward the issuer's region (§4-A).
 */
export function assessCertificate(state: WorldState, viewerRegionId: string, cert: Certificate): CertAssessment {
  const viewer = getRegion(state, viewerRegionId);
  if (!viewer)
    return { honored: false, stance: "unknown-issuer", reason: `viewer region "${viewerRegionId}" does not exist`, mapped: false };

  // FORM: the issuer must be a known agent; verify the signature with its public key.
  const issuer = getAgent(state, cert.issuer);
  if (!issuer) return { honored: false, stance: "unknown-issuer", reason: `issuer "${cert.issuer}" is not a known agent`, mapped: false };
  const form = verifyCertificate(cert, decodeBase64(issuer.publicKey));
  if (!form.ok) return { honored: false, stance: "form-invalid", reason: form.reason, mapped: false };

  const issuerRegion = parseIdentifier(cert.issuer)?.region;
  if (!issuerRegion) return { honored: false, stance: "form-invalid", reason: "issuer identifier has no region", mapped: false };

  // MEANING:
  if (issuerRegion === viewerRegionId) {
    const honored = acceptsSchema(viewer, cert.schemaId);
    return {
      honored,
      stance: "domestic",
      reason: honored ? "domestic cert under local policy" : "schema not accepted locally",
      mapped: false,
    };
  }

  const stance = stanceToward(viewer, issuerRegion);
  switch (stance) {
    case "absorb":
      return { honored: true, stance, reason: "accepted as-is", mapped: false };
    case "map":
      return { honored: true, stance, reason: "translated into the local vocabulary", mapped: true };
    case "reexamine": {
      const honored = acceptsSchema(viewer, cert.schemaId);
      return {
        honored,
        stance,
        reason: honored ? "re-examined and accepted under local policy" : "re-examined and rejected (schema not accepted)",
        mapped: false,
      };
    }
    case "reject":
      return { honored: false, stance, reason: `${viewerRegionId} rejects ${issuerRegion}'s certificates`, mapped: false };
  }
}

/** Whether a cross-region value transfer is diplomatically allowed: both recognized, receiver not rejecting (§4-C). */
export function canTransactAcross(state: WorldState, fromRegion: string, toRegion: string): Result {
  const a = getRegion(state, fromRegion);
  const b = getRegion(state, toRegion);
  if (!a || !b) return { ok: false, reason: "unknown-region" };
  if (a.status !== "recognized") return { ok: false, reason: "sender-region-unrecognized" };
  if (b.status !== "recognized") return { ok: false, reason: "receiver-region-unrecognized" };
  if (stanceToward(b, fromRegion) === "reject") return { ok: false, reason: "receiver-rejects-sender" };
  return { ok: true };
}

/**
 * Recognition flow (§4-C): an already-recognized region recognizes a founded
 * (unrecognized) one, admitting it to the international society. A region cannot be
 * recognized by an unrecognized one. (Staged due-diligence is a future refinement.)
 */
export function recognizeRegion(env: WorldCommit, by: string, target: string): RegionState {
  const state = env.getState();
  const recognizer = getRegion(state, by);
  const t = getRegion(state, target);
  if (!recognizer) throw new Error(`recognizeRegion: recognizer "${by}" does not exist`);
  if (recognizer.status !== "recognized") throw new Error(`recognizeRegion: recognizer "${by}" is itself unrecognized`);
  if (!t) throw new Error(`recognizeRegion: target "${target}" does not exist`);
  if (t.status === "recognized") return t; // idempotent

  env.commitSystem(EVENT_REGION_RECOGNIZED, { regionId: target, by });
  return readBackOrThrow("recognizeRegion", getRegion(env.getState(), target));
}
