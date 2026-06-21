// 第2層 Region (村) — types.
//
// A village is NOT hardcoded: it is a DATA definition that carries its
// institutions (§2-A). Institutions are kept as swappable "settings" (§8): the
// path to replace them is the future viewer-legislator hook — present as plumbing,
// not yet activated.
//
// The trust core (M0) is unchanged here; the only thing that grows is the set of
// `region` strings (§2 設計の約束).

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
 *   absorb    — 丸呑み: accept as-is
 *   map       — マッピング: convert the foreign type into a local one
 *   reexamine — 再審査: treat as a hint, re-check under local rules
 *   reject    — 拒否: do not accept
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
 * Who proposed a founding (発議者, §2 設計の約束). The SAME execution engine
 * serves every proposer:
 *   genesis      — the initial world (born recognized)
 *   experimenter — (イ) external injection, the god view  [implemented in M2]
 *   emergence    — (ロ) internal emergence from the world [interface only; trigger in M3+]
 */
export type Proposer =
  | { readonly kind: "genesis" }
  | { readonly kind: "experimenter"; readonly note?: string }
  | { readonly kind: "emergence"; readonly sourceRegion: string; readonly reason: string; readonly cohort: readonly string[] };

/** Recognition status. Founded villages are born "unrecognized"; M4 grants "recognized". */
export type RecognitionStatus = "unrecognized" | "recognized";

/** A founding proposal: the single interface both (イ) and (ロ) flow through. */
export interface FoundingProposal {
  readonly definition: RegionDefinition;
  readonly proposer: Proposer;
}

/** An institution amendment (the 立法者 plumbing; §8). Logged, never silent. */
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
  // residency is NOT stored here — it is derived from the agent slice (AgentState.region,
  // via agentsInRegion), keeping a single source of truth (audit 3-A / EMG-2).
}

// --- event constants + payload shapes ------------------------------------

export const EVENT_REGION_FOUNDED = "region.founded";
export const EVENT_REGION_INSTITUTION_CHANGED = "region.institution.changed";

export type RegionFoundedPayload = {
  region: RegionDefinition;
  proposer: Proposer;
  status: RecognitionStatus;
};

export type InstitutionChangedPayload = {
  regionId: string;
  change: InstitutionChange;
  proposer: Proposer;
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
