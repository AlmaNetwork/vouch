// Layer 2 Region (village) — types.
//
// A village is NOT hardcoded: it is a DATA definition that carries its
// institutions (§2-A). Institutions are kept as swappable "settings" (§8): the
// path to replace them is the future viewer-legislator hook — present as plumbing,
// not yet activated.
//
// The trust core (M0) is unchanged here; the only thing that grows is the set of
// `region` strings (§2 design promise).

// --- institutions (the minimal governance set, §2-A) ---------------------

/** An entry in a village's certificate-schema ledger: a schema it declares valid. */
export interface SchemaLedgerEntry {
  readonly schemaId: string;
  readonly label?: string;
}

/** How a village verifies certificates / what it deems valid. Data, so it is swappable. */
export interface VerificationPolicy {
  readonly acceptedSchemaIds: readonly string[];
  readonly rejectUnknownSchemas: boolean;
}

/**
 * How a foreign certificate is translated into the local vocabulary (§4-A).
 *   absorb    — swallow whole: accept as-is
 *   map       — mapping: convert the foreign type into a local one
 *   reexamine — re-examination: treat as a hint, re-check under local rules
 *   reject    — rejection: do not accept
 * In M2 this is only carried as data; the behavior arrives in M4.
 */
export type ForeignCertStance = "absorb" | "map" | "reexamine" | "reject";

/** How a village treats OTHER villages' certificates. Fully exercised in M4. */
export interface DiplomacyPolicy {
  readonly defaultStance: ForeignCertStance;
  readonly overrides: Readonly<Record<string, ForeignCertStance>>;
}

/** The minimal institution set a village holds (§2-A). */
export interface Institutions {
  readonly schemaLedger: readonly SchemaLedgerEntry[];
  readonly verificationPolicy: VerificationPolicy;
  readonly diplomacyPolicy: DiplomacyPolicy;
}

/** A village definition — pure data. Adding a village = adding one of these. */
export interface RegionDefinition {
  readonly id: string; // the `region` string, e.g. "umi"
  readonly displayName: string;
  readonly institutions: Institutions;
}

// --- founding (proposal + status) ----------------------------------------

/**
 * Who proposed a founding (the proposer, §2 design promise). The SAME execution engine
 * serves every proposer:
 *   genesis      — the initial world (born recognized)
 *   experimenter — (a) external injection, the god view  [implemented in M2]
 *   emergence    — (b) internal emergence from the world [interface only; trigger in M3+]
 */
export type Proposer =
  | { readonly kind: "genesis" }
  | { readonly kind: "experimenter"; readonly note?: string }
  | { readonly kind: "emergence"; readonly sourceRegion: string; readonly reason: string; readonly cohort: readonly string[] };

/** Recognition status. Founded villages are born "unrecognized"; M4 grants "recognized". */
export type RecognitionStatus = "unrecognized" | "recognized";

/** A founding proposal: the single interface both (a) and (b) flow through. */
export interface FoundingProposal {
  readonly definition: RegionDefinition;
  readonly proposer: Proposer;
  // Who will GOVERN the founded region (one person = one region). An account/principal
  // id, or null for a system/unowned region (genesis, emergence). Owner is orthogonal
  // to `proposer` (who proposed it): a human founds AND governs; the world seeds genesis.
  readonly owner: string | null;
}

/** An institution amendment (the legislator plumbing; §8). Logged, never silent. */
export type InstitutionChange =
  | { readonly policy: "verification"; readonly value: VerificationPolicy }
  | { readonly policy: "diplomacy"; readonly value: DiplomacyPolicy }
  | { readonly policy: "schemaLedger"; readonly value: readonly SchemaLedgerEntry[] };

// --- runtime state (derived from events) ---------------------------------

export interface RegionState {
  readonly id: string;
  readonly displayName: string;
  readonly institutions: Institutions;
  readonly status: RecognitionStatus;
  readonly proposer: Proposer;
  readonly foundedAtSeq: number; // log seq, NOT sim tick (audit G5: protocol state orders by seq)
  // The account that GOVERNS this region (one person = one region). null = system/unowned
  // (genesis, emergence). The region market later transfers this; the region is never deleted.
  readonly owner: string | null;
  // residency is NOT stored here — it is derived from the agent slice (AgentState.region,
  // via agentsInRegion), keeping a single source of truth (audit 3-A / EMG-2).
}

// --- event constants + payload shapes ------------------------------------

export const EVENT_REGION_FOUNDED = "region.founded";
export const EVENT_REGION_INSTITUTION_CHANGED = "region.institution.changed";
export const EVENT_REGION_RECOGNIZED = "region.recognized"; // M4: a region joins the international society

export type RegionFoundedPayload = {
  region: RegionDefinition;
  proposer: Proposer;
  status: RecognitionStatus;
  owner: string | null;
};

export type InstitutionChangedPayload = {
  regionId: string;
  change: InstitutionChange;
  proposer: Proposer;
};

export type RegionRecognizedPayload = {
  regionId: string;
  by: string; // the recognizing region
};

// --- builders (convenience; villages are still just data) ----------------

export function makeInstitutions(partial: Partial<Institutions> = {}): Institutions {
  return {
    schemaLedger: partial.schemaLedger ?? [],
    verificationPolicy: partial.verificationPolicy ?? { acceptedSchemaIds: [], rejectUnknownSchemas: true },
    diplomacyPolicy: partial.diplomacyPolicy ?? { defaultStance: "reexamine", overrides: {} },
  };
}

export function defineRegion(id: string, displayName: string, institutions: Institutions = makeInstitutions()): RegionDefinition {
  return { id, displayName, institutions };
}
