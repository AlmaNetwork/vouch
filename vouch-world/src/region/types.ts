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

/**
 * WHO may govern (amend) a village — its constitution (§8). Data, so a village can
 * pick its own template and even amend it (a dictator can open a council).
 *   dictatorship — the region's `owner` is the sole authority.
 *   council      — any listed member may act (P2). `threshold` is reserved for the
 *                  P3 proposal/vote mechanism; in P2 a single member may amend.
 */
export type Governance =
  | { readonly kind: "dictatorship" }
  | { readonly kind: "council"; readonly members: readonly string[]; readonly threshold: number };

/**
 * A village's own economic policy — the trust-cost (fee/tax) schedule + credit accrual.
 * Data, so the region's owner sets it (sovereignty over its economy, §2-4). Read by
 * executeTransfer for the SENDER's region.
 */
export interface EconomyPolicy {
  readonly baseCostRate: number; // fee rate at reputation 0 (the ceiling)
  readonly minCostRate: number; // fee-rate floor (high reputation)
  readonly repDiscount: number; // fee-rate reduction per reputation point
  readonly creditPerTx: number; // credit accrued per settlement leg
}

/** The minimal institution set a village holds (§2-A). */
export interface Institutions {
  readonly schemaLedger: readonly SchemaLedgerEntry[];
  readonly verificationPolicy: VerificationPolicy;
  readonly diplomacyPolicy: DiplomacyPolicy;
  readonly governance: Governance;
  readonly economyPolicy: EconomyPolicy;
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

/**
 * Lifecycle (orthogonal to recognition): an "active" region runs; a "dormant" one is
 * hibernated by its owner and can be listed + sold. A region is NEVER deleted — a defunct
 * one is hibernated and its ownership transferred on the market (P3 "instance control").
 */
export type RegionLifecycle = "active" | "dormant";

/** A founding proposal: the single interface both (a) and (b) flow through. */
export interface FoundingProposal {
  readonly definition: RegionDefinition;
  readonly proposer: Proposer;
  // Who will GOVERN the founded region: an account/principal id, or null for a
  // system/unowned region (genesis, emergence). The Sybil rule is 1 person = 1 ID;
  // an ID may be resident and/or founder, and may govern MULTIPLE regions. Owner is
  // orthogonal to `proposer` (who proposed it): a human founds AND governs; world seeds genesis.
  readonly owner: string | null;
}

/** An institution amendment (the legislator plumbing; §8). Logged, never silent. */
export type InstitutionChange =
  | { readonly policy: "verification"; readonly value: VerificationPolicy }
  | { readonly policy: "diplomacy"; readonly value: DiplomacyPolicy }
  | { readonly policy: "schemaLedger"; readonly value: readonly SchemaLedgerEntry[] }
  | { readonly policy: "governance"; readonly value: Governance } // constitutional change (P2)
  | { readonly policy: "economy"; readonly value: EconomyPolicy }; // fee/tax policy (P2)

/**
 * An OPEN council amendment proposal (P3 voting): the proposed change plus who has voted
 * for it so far. A region has at most one open proposal; it resolves (applies + clears)
 * when `votes.length` reaches the council's `threshold`.
 */
export type GovProposal = { change: InstitutionChange; votes: readonly string[]; proposedBy: string };

// --- runtime state (derived from events) ---------------------------------

export interface RegionState {
  readonly id: string;
  readonly displayName: string;
  readonly institutions: Institutions;
  readonly status: RecognitionStatus;
  readonly proposer: Proposer;
  readonly foundedAtSeq: number; // log seq, NOT sim tick (audit G5: protocol state orders by seq)
  // The account/ID that GOVERNS this region. null = system/unowned (genesis, emergence).
  // An ID may govern MULTIPLE regions (Sybil resistance is 1-person-1-ID, NOT one-region-
  // per-person). The region market later transfers this; the region is never deleted.
  readonly owner: string | null;
  readonly lifecycle: RegionLifecycle; // active | dormant (P3); born active
  readonly salePrice: number | null; // asking price when listed on the market; null = not for sale
  readonly openProposal: GovProposal | null; // the council's one in-flight amendment vote (P3); null when none
  // residency is NOT stored here — it is derived from the agent slice (AgentState.region,
  // via agentsInRegion), keeping a single source of truth (audit 3-A / EMG-2).
}

// --- event constants + payload shapes ------------------------------------

export const EVENT_REGION_FOUNDED = "region.founded";
export const EVENT_REGION_INSTITUTION_CHANGED = "region.institution.changed";
export const EVENT_REGION_RECOGNIZED = "region.recognized"; // M4: a region joins the international society
export const EVENT_REGION_LIFECYCLE_CHANGED = "region.lifecycle.changed"; // P3: active <-> dormant
export const EVENT_REGION_LISTED = "region.listed"; // P3: owner sets an asking price (null = delist)
export const EVENT_REGION_OWNERSHIP_TRANSFERRED = "region.ownership.transferred"; // P3: sold/handed over (never deleted)
export const EVENT_GOV_PROPOSAL_OPENED = "gov.proposal.opened"; // P3: a council member proposes an amendment
export const EVENT_GOV_VOTE_CAST = "gov.vote.cast"; // P3: a council member votes; resolves at threshold

export type RegionFoundedPayload = {
  region: RegionDefinition;
  proposer: Proposer;
  status: RecognitionStatus;
  owner: string | null;
};

export type InstitutionChangedPayload = {
  regionId: string;
  change: InstitutionChange;
  by: string; // the acting principal (account/ID) that amended — provenance + authorization
};

export type RegionRecognizedPayload = {
  regionId: string;
  by: string; // the recognizing region
};

export type RegionLifecycleChangedPayload = { regionId: string; lifecycle: RegionLifecycle };
export type RegionListedPayload = { regionId: string; salePrice: number | null };
export type RegionOwnershipTransferredPayload = { regionId: string; from: string; to: string; price: number | null };
export type GovProposalOpenedPayload = { regionId: string; change: InstitutionChange; by: string };
export type GovVoteCastPayload = { regionId: string; voter: string };

// --- builders (convenience; villages are still just data) ----------------

/**
 * Reject incoherent governance. An empty (or all-self-excluding) council can NEVER be
 * amended again — `canGovern` would return false for everyone, permanently bricking the
 * region — so an empty member set is forbidden. The threshold must be a sane integer.
 */
export function validateGovernance(g: Governance): void {
  if (g.kind === "council") {
    if (g.members.length === 0) {
      throw new Error("governance: a council must have at least one member (an empty council can never be amended)");
    }
    if (!Number.isInteger(g.threshold) || g.threshold < 1 || g.threshold > g.members.length) {
      throw new Error(`governance: council threshold must be an integer in [1, ${g.members.length}]`);
    }
  }
}

/**
 * Reject a degenerate economy policy. Fee rates MUST be in [0, 1] — so a fee can never
 * exceed the amount transferred (which would drive the recipient's balance negative) nor
 * be negative (which would over-credit the recipient and underflow the treasury). The floor
 * must not exceed the ceiling; repDiscount is non-negative; creditPerTx is a non-negative int.
 */
export function validateEconomyPolicy(p: EconomyPolicy): void {
  const inUnit = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1;
  if (!inUnit(p.baseCostRate) || !inUnit(p.minCostRate)) {
    throw new Error("economyPolicy: baseCostRate and minCostRate must be in [0, 1]");
  }
  if (p.minCostRate > p.baseCostRate) {
    throw new Error("economyPolicy: minCostRate must be <= baseCostRate");
  }
  if (!Number.isFinite(p.repDiscount) || p.repDiscount < 0) {
    throw new Error("economyPolicy: repDiscount must be a finite number >= 0");
  }
  if (!Number.isInteger(p.creditPerTx) || p.creditPerTx < 0) {
    throw new Error("economyPolicy: creditPerTx must be an integer >= 0");
  }
}

export function makeInstitutions(partial: Partial<Institutions> = {}): Institutions {
  const governance: Governance = partial.governance ?? { kind: "dictatorship" };
  const economyPolicy: EconomyPolicy = partial.economyPolicy ?? { baseCostRate: 0.2, minCostRate: 0.05, repDiscount: 0.02, creditPerTx: 1 };
  validateGovernance(governance);
  validateEconomyPolicy(economyPolicy);
  return {
    schemaLedger: partial.schemaLedger ?? [],
    verificationPolicy: partial.verificationPolicy ?? { acceptedSchemaIds: [], rejectUnknownSchemas: true },
    diplomacyPolicy: partial.diplomacyPolicy ?? { defaultStance: "reexamine", overrides: {} },
    governance,
    economyPolicy,
  };
}

export function defineRegion(id: string, displayName: string, institutions: Institutions = makeInstitutions()): RegionDefinition {
  return { id, displayName, institutions };
}
