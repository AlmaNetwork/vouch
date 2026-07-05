// A starter library of credential types — examples of the "various elements" a
// certificate can carry, each with a different structured shape. Add your own with
// defineCredentialType; the universal envelope never changes.

import { isValidIdentifier, isValidRegion } from "vouch-core";
import { z } from "zod";
import { CredentialRegistry, defineCredentialType } from "./types";

const identifier = z.string().refine(isValidIdentifier, "must be a valid name@region identifier");

/** A skill attestation: the holder can do X at level N. */
export const SkillCredential = defineCredentialType(
  "alma.skill/v1",
  z.object({ skill: z.string().min(1), level: z.number().int().min(0).max(10) }),
  "skill",
);

/** Membership of an organization in a role, since a date. */
export const MembershipCredential = defineCredentialType(
  "alma.membership/v1",
  z.object({ org: z.string().min(1), role: z.string().min(1), since: z.string().min(1) }),
  "membership",
);

/** A claim over some amount of an asset (e.g. a deed, a license quota). */
export const AssetCredential = defineCredentialType(
  "alma.asset/v1",
  z.object({ kind: z.string().min(1), amount: z.number().nonnegative(), unit: z.string().min(1) }),
  "asset",
);

/** One party endorsing another, with a weight and optional note. */
export const EndorsementCredential = defineCredentialType(
  "alma.endorsement/v1",
  z.object({ of: identifier, weight: z.number().int().min(1).max(5), note: z.string().optional() }),
  "endorsement",
);

/**
 * An OFFICE attestation (C2 representation): the subject holds a region's stewardship —
 * the acknowledged entitlement to speak for the village (auctoritas). The office-of-record
 * stays the region's `owner` pointer (RFC 0001 §4: a role pointer, never a shared key);
 * this credential is the PORTABLE EVIDENCE of that office, issued and honored like any
 * other cert — so "region X approved" gets a verifiable subject. `since` is any non-empty
 * string (like membership's); deriving it from the tick (never the wall clock) is the
 * ISSUER's responsibility, as with every `issuedAt` in domain code.
 */
export const StewardCredential = defineCredentialType(
  "alma.gov/steward/v1",
  z.object({
    region: z.string().refine(isValidRegion, "must be a valid region string"),
    title: z.string().min(1),
    since: z.string().min(1),
  }),
  "steward",
);

export const STANDARD_CREDENTIALS = [
  SkillCredential,
  MembershipCredential,
  AssetCredential,
  EndorsementCredential,
  StewardCredential,
] as const;

/** A registry pre-loaded with the standard credential types. */
export function standardRegistry(): CredentialRegistry {
  const registry = new CredentialRegistry();
  for (const type of STANDARD_CREDENTIALS) registry.register(type);
  return registry;
}
