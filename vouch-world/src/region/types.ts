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
 *
 * RFC 0001 §4 hardens the collective path with OPTIONAL per-region tunable guards.
 * Every new field defaults to EXACTLY the historic behavior when absent (additive,
 * backward-compatible), so old logs and old presets are untouched. They are presets /
 * affordances a founder sets and sweeps as experiment parameters — the regime that
 * results is measured (RFC 0002), never configured.
 */
export type Governance =
  | { readonly kind: "dictatorship" }
  | {
      readonly kind: "council";
      readonly members: readonly string[];
      // Minimum APPROVING WEIGHT for a proposal to resolve. Under the defaults
      // (electorate "members", weighting "equal") every ballot weighs 1, so this is
      // numerically the historic vote COUNT threshold.
      readonly threshold: number;
      // WHO may vote (RFC 0001 §4 eligibility): "members" (default) = the listed council
      // members, today's behavior. "citizens" = every agent whose CITIZENSHIP — the home
      // region encoded in its id (name@region) — is this region; residence is irrelevant
      // (migration never changes citizenship) and the treasury account is excluded.
      readonly electorate?: "members" | "citizens";
      // Minimum BALLOT COUNT cast for a resolution to bind (participation floor, §4
      // quorum) — distinct from `threshold`, which bounds weight, not turnout.
      readonly quorum?: number;
      // Voter tenure (§4): an ID is on a proposal's roll only if
      // openSeq - admittedAtSeq >= tenureSeq. Measured in log seq, never wall-clock
      // (audit G5). NOT a Sybil tool — it is the incumbent-vs-insurgent axis.
      readonly tenureSeq?: number;
      // Founding maturity (§4): a governance-kind (constitutional) proposal may not even
      // OPEN until the electorate holds >= maturity eligible IDs.
      readonly maturity?: number;
      // Ballot weight source (§4, the legitimacy axis: democracy / meritocracy /
      // plutocracy). Weight per voter = 1 (equal, default) | 1 + reputation | 1 +
      // balances.currency, evaluated AT proposal open (§5 snapshot).
      readonly weighting?: "equal" | "reputation" | "stake";
    };

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

/**
 * A region's finite RESOURCE pool config (P3 scarcity, the "competition" substrate): the pool
 * holds up to `capacity` and is produced into at `regenPerTick` each tick. Owner-set. Default
 * {0,0} means the region has no resource (backward-compatible). Agents compete to DRAW the
 * limited flow — when the pool is depleted, late drawers get nothing.
 */
export interface ResourcePolicy {
  readonly capacity: number;
  readonly regenPerTick: number;
}

/** The minimal institution set a village holds (§2-A). */
export interface Institutions {
  readonly schemaLedger: readonly SchemaLedgerEntry[];
  readonly verificationPolicy: VerificationPolicy;
  readonly diplomacyPolicy: DiplomacyPolicy;
  readonly governance: Governance;
  readonly economyPolicy: EconomyPolicy;
  readonly resourcePolicy: ResourcePolicy;
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
  | { readonly policy: "economy"; readonly value: EconomyPolicy } // fee/tax policy (P2)
  | { readonly policy: "resource"; readonly value: ResourcePolicy }; // resource pool config (P3)

/** One eligible voter on a proposal's SNAPSHOT roll, with its weight evaluated AT OPEN (RFC 0001 §5). */
export type GovRollEntry = { readonly voter: string; readonly weight: number };

/**
 * An OPEN council amendment proposal (P3 voting): the proposed change plus who has voted
 * for it so far. A region has at most one open proposal; it resolves (applies + clears)
 * once the APPROVING WEIGHT summed over `roll` reaches the council's `threshold` AND, if
 * a quorum is set, enough ballots were cast (RFC 0001 §4/§5). A ballot is approval-only:
 * casting one IS approving. `roll` is the §5 snapshot taken when the proposal opened —
 * immutable for this proposal's lifetime: joining / leaving / migrating / transferring
 * value after `openedAtSeq` changes NOTHING for it (voter-roll cutoff).
 */
export type GovProposal = {
  change: InstitutionChange;
  votes: readonly string[];
  proposedBy: string;
  openedAtSeq: number; // the log seq at which the roll closed (stamped from event.seq, audit G5)
  roll: readonly GovRollEntry[]; // eligible voters (electorate x tenure) with weights AT OPEN
};

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
  readonly resourceLevel: number; // current amount in the region's resource pool (P3); born 0
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
export const EVENT_RESOURCE_REGENERATED = "resource.regenerated"; // P3: the region pool is produced into
export const EVENT_RESOURCE_DRAWN = "resource.drawn"; // P3: an agent draws from the pool (pool -> agent)

export type RegionFoundedPayload = {
  readonly region: RegionDefinition;
  readonly proposer: Proposer;
  readonly status: RecognitionStatus;
  readonly owner: string | null;
};

export type InstitutionChangedPayload = {
  readonly regionId: string;
  readonly change: InstitutionChange;
  readonly by: string; // the acting principal (account/ID) that amended — provenance + authorization
};

export type RegionRecognizedPayload = {
  readonly regionId: string;
  readonly by: string; // the recognizing region
};

export type RegionLifecycleChangedPayload = { readonly regionId: string; readonly lifecycle: RegionLifecycle };
export type RegionListedPayload = { readonly regionId: string; readonly salePrice: number | null };
export type RegionOwnershipTransferredPayload = {
  readonly regionId: string;
  readonly from: string;
  readonly to: string;
  readonly price: number | null;
};
export type GovProposalOpenedPayload = {
  readonly regionId: string;
  readonly change: InstitutionChange;
  readonly by: string;
  // RFC 0001 §5 snapshot: the FINAL voter roll — electorate x tenure, weights evaluated
  // AT OPEN — computed by the env write path (which knows the open seq pre-commit via
  // CommitSink.nextSeq) and folded verbatim by the reducer. OPTIONAL for backward
  // compatibility — events logged before this field existed fold to the historic
  // members / weight-1 roll. Forged rolls cannot enter: the region reducer folds only
  // SYSTEM_ACTOR-authored events, and commitSystem is env-only (defence in depth).
  readonly roll?: readonly GovRollEntry[];
};
// `by` = the acting principal (the council member casting the vote), consistent with the other payloads.
export type GovVoteCastPayload = { readonly regionId: string; readonly by: string };
export type ResourceRegeneratedPayload = { readonly regionId: string; readonly amount: number };
export type ResourceDrawnPayload = { readonly regionId: string; readonly agentId: string; readonly amount: number };

/** Maps each region-slice event type to its payload — the typed `commit` helper keys off this. */
export interface RegionEventMap {
  [EVENT_REGION_FOUNDED]: RegionFoundedPayload;
  [EVENT_REGION_INSTITUTION_CHANGED]: InstitutionChangedPayload;
  [EVENT_REGION_RECOGNIZED]: RegionRecognizedPayload;
  [EVENT_REGION_LIFECYCLE_CHANGED]: RegionLifecycleChangedPayload;
  [EVENT_REGION_LISTED]: RegionListedPayload;
  [EVENT_REGION_OWNERSHIP_TRANSFERRED]: RegionOwnershipTransferredPayload;
  [EVENT_GOV_PROPOSAL_OPENED]: GovProposalOpenedPayload;
  [EVENT_GOV_VOTE_CAST]: GovVoteCastPayload;
  [EVENT_RESOURCE_REGENERATED]: ResourceRegeneratedPayload;
  [EVENT_RESOURCE_DRAWN]: ResourceDrawnPayload;
}

// --- builders (convenience; villages are still just data) ----------------

/**
 * Reject incoherent governance. An empty (or all-self-excluding) council can NEVER be
 * amended again — `canGovern` would return false for everyone, permanently bricking the
 * region — so an empty member set is forbidden. The threshold must be a sane integer.
 * The RFC 0001 §4 tunables are bounds-checked here too, in the same brick-guard spirit,
 * so an incoherent preset is rejected at found/amend time before it can land.
 */
export function validateGovernance(g: Governance): void {
  if (g.kind === "council") {
    if (g.members.length === 0) {
      throw new Error("governance: a council must have at least one member (an empty council can never be amended)");
    }
    const electorate = g.electorate ?? "members";
    const weighting = g.weighting ?? "equal";
    if (electorate !== "members" && electorate !== "citizens") {
      throw new Error(`governance: electorate must be "members" or "citizens"`);
    }
    if (weighting !== "equal" && weighting !== "reputation" && weighting !== "stake") {
      throw new Error(`governance: weighting must be "equal", "reputation" or "stake"`);
    }
    // `threshold` bounds WEIGHT. Under the defaults (members electorate, equal weighting)
    // the maximum attainable approving weight is exactly members.length, so the historic
    // cap stays — a threshold above it could never resolve (brick). Under "citizens" or a
    // non-equal weighting the attainable weight is dynamic (evaluated at proposal open),
    // so only the integer >= 1 part is statically checkable.
    if (electorate === "members" && weighting === "equal") {
      if (!Number.isInteger(g.threshold) || g.threshold < 1 || g.threshold > g.members.length) {
        throw new Error(`governance: council threshold must be an integer in [1, ${g.members.length}]`);
      }
    } else if (!Number.isInteger(g.threshold) || g.threshold < 1) {
      throw new Error("governance: council threshold must be an integer >= 1");
    }
    if (g.quorum !== undefined) {
      if (!Number.isInteger(g.quorum) || g.quorum < 1) {
        throw new Error("governance: quorum must be an integer >= 1");
      }
      // With a fixed members electorate the ballot ceiling is members.length — a quorum
      // above it could never bind (unresolvable, same brick shape as the threshold cap).
      if (electorate === "members" && g.quorum > g.members.length) {
        throw new Error(`governance: quorum must not exceed the ${g.members.length} council members (a resolution could never bind)`);
      }
    }
    if (g.tenureSeq !== undefined && (!Number.isInteger(g.tenureSeq) || g.tenureSeq < 0)) {
      throw new Error("governance: tenureSeq must be an integer >= 0");
    }
    if (g.maturity !== undefined && (!Number.isInteger(g.maturity) || g.maturity < 0)) {
      throw new Error("governance: maturity must be an integer >= 0");
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

/** Reject a degenerate resource policy: capacity and per-tick production must be non-negative integers. */
export function validateResourcePolicy(p: ResourcePolicy): void {
  if (!Number.isInteger(p.capacity) || p.capacity < 0) throw new Error("resourcePolicy: capacity must be an integer >= 0");
  if (!Number.isInteger(p.regenPerTick) || p.regenPerTick < 0) throw new Error("resourcePolicy: regenPerTick must be an integer >= 0");
}

export function makeInstitutions(partial: Partial<Institutions> = {}): Institutions {
  const governance: Governance = partial.governance ?? { kind: "dictatorship" };
  const economyPolicy: EconomyPolicy = partial.economyPolicy ?? { baseCostRate: 0.2, minCostRate: 0.05, repDiscount: 0.02, creditPerTx: 1 };
  const resourcePolicy: ResourcePolicy = partial.resourcePolicy ?? { capacity: 0, regenPerTick: 0 };
  validateGovernance(governance);
  validateEconomyPolicy(economyPolicy);
  validateResourcePolicy(resourcePolicy);
  return {
    schemaLedger: partial.schemaLedger ?? [],
    verificationPolicy: partial.verificationPolicy ?? { acceptedSchemaIds: [], rejectUnknownSchemas: true },
    diplomacyPolicy: partial.diplomacyPolicy ?? { defaultStance: "reexamine", overrides: {} },
    governance,
    economyPolicy,
    resourcePolicy,
  };
}

export function defineRegion(id: string, displayName: string, institutions: Institutions = makeInstitutions()): RegionDefinition {
  return { id, displayName, institutions };
}
