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

// --- decision mechanism (T1: governance form as first-class DATA) --------
//
// Until now "who decides, and how" was hardcoded: founding / recognition /
// amendment were all executed directly by SYSTEM_ACTOR (the god hand), so the
// governance FORM was an implicit constant and the research had no independent
// variable. T1 lifts that form into data a Region carries, exactly like its other
// institutions. Voting is NOT the abstraction — it is one option among many. A
// decision is described by independent slots, so a Region can MIX them (e.g.
// propose = reputation≥X, decide = M-of-N council, override = a single key).
//
// MVP wires two forms (dictatorship + M-of-N council). The TYPE is the general
// shape the 12 legitimacy classes (autocracy / council / experts / reputation /
// stake / rough-consensus / oracle-constitution / figurehead / sortition /
// random-beacon / de-facto / exit-fork) all reduce to — reached by adding
// variants below, never by changing the engine. Real cryptographic voting / MPC /
// threshold signatures are explicitly OUT of MVP scope: a "ballot" here is just a
// logged event, and "M-of-N" is a COUNT, not a threshold signature.

/**
 * A predicate over an actor (an agent id, or SYSTEM_ACTOR), evaluated against
 * world state. This is the ONE shared vocabulary that both the decision engine
 * (write side) and the future T2 authority checks (read side) consume — so
 * "who may do what" has a single source of truth.
 */
export type Qualifier =
  | { readonly kind: "anyone" }
  | { readonly kind: "system" } // SYSTEM_ACTOR only — the god hand
  | { readonly kind: "agent"; readonly id: string } // a named actor (e.g. the dictator)
  | { readonly kind: "group"; readonly ids: readonly string[] } // a council membership
  | { readonly kind: "role"; readonly role: string } // by job (an AgentRole value; kept as string so region/ stays free of agent/ imports)
  | { readonly kind: "reputationAtLeast"; readonly min: number } // credit/reputation legitimacy
  | { readonly kind: "resident" } // belongs to THIS region (residency, via agentsInRegion)
  | { readonly kind: "all"; readonly of: readonly Qualifier[] } // AND
  | { readonly kind: "any"; readonly of: readonly Qualifier[] }; // OR

/** What a participant's vote is weighted by. */
export type Weighting =
  | { readonly kind: "equal" } // one-actor-one-vote
  | { readonly kind: "reputation" } // reputation-weighted
  | { readonly kind: "stakeCurrency" } // capital/stake-weighted (balances.currency)
  | { readonly kind: "stakeCredit" }; // credit-weighted (balances.credit)

/**
 * How accumulated ballots resolve into an outcome.
 *   singleAuthority — one approving ballot from an eligible actor decides (autocracy)
 *   threshold       — M approving ballots decide (M-of-N council)
 *   weightedFraction / sortition / randomBeacon — TYPED for the general form, but
 *     NOT wired by the MVP engine (reserved; the latter two need the engine RNG).
 */
export type SelectionRule =
  | { readonly kind: "singleAuthority" }
  | { readonly kind: "threshold"; readonly approvals: number }
  | { readonly kind: "weightedFraction"; readonly min: number } // approve-weight / cast-weight ≥ min
  | { readonly kind: "sortition" } // RNG draws the decider among the eligible
  | { readonly kind: "randomBeacon"; readonly approveProbability: number };

/** A governance form, expressed entirely as data — the 8 slots (T1). */
export interface DecisionMechanism {
  readonly proposalRule: Qualifier; // ① who may propose
  readonly eligibilityRule: Qualifier; // ② who may participate
  readonly weightingRule: Weighting; //    how participants are weighted
  readonly selectionRule: SelectionRule; // ③ how the outcome is decided
  readonly executionRule: Qualifier; //    who executes (MVP: always {kind:"system"})
  readonly vetoRule: Qualifier | null; //  who may block (MVP: null)
  readonly appealRule: Qualifier | null; // who may appeal (MVP: null)
  readonly emergencyRule: Qualifier | null; // who may override in an emergency (MVP: null)
}

/**
 * What a decision is ABOUT — drawn from the existing sanctioned write operations,
 * so an approved decision simply calls the engine that already exists. Extensible.
 */
export type GovernanceAction =
  | { readonly kind: "amendInstitution"; readonly change: InstitutionChange }
  | { readonly kind: "recognizeRegion"; readonly target: string };

/** The minimal institution set a village holds (§2-A). */
export interface Institutions {
  readonly schemaLedger: readonly SchemaLedgerEntry[];
  readonly verificationPolicy: VerificationPolicy;
  readonly diplomacyPolicy: DiplomacyPolicy;
  readonly decisionMechanism: DecisionMechanism; // T1: the governance form, as data
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
}

/** An institution amendment (the legislator plumbing; §8). Logged, never silent. */
export type InstitutionChange =
  | { readonly policy: "verification"; readonly value: VerificationPolicy }
  | { readonly policy: "diplomacy"; readonly value: DiplomacyPolicy }
  | { readonly policy: "schemaLedger"; readonly value: readonly SchemaLedgerEntry[] }
  // T1: a region can change its OWN governance form — the form is itself amendable data.
  | { readonly policy: "decisionMechanism"; readonly value: DecisionMechanism };

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
export const EVENT_REGION_RECOGNIZED = "region.recognized"; // M4: a region joins the international society

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

export type RegionRecognizedPayload = {
  regionId: string;
  by: string; // the recognizing region
};

// --- decision lifecycle (T1): propose -> accumulate ballots -> resolve ----
//
// Every step is an event, so the whole decision is replayable and the outcome is
// a deterministic fold — no clock, and any randomness goes through the engine RNG.

export const EVENT_DECISION_OPENED = "decision.opened";
export const EVENT_DECISION_BALLOT = "decision.ballot";
export const EVENT_DECISION_RESOLVED = "decision.resolved";

export type DecisionOutcome = "open" | "approved" | "rejected";

export type DecisionOpenedPayload = {
  regionId: string;
  action: GovernanceAction;
  mechanism: DecisionMechanism; // SNAPSHOT at open, so the decision's meaning is fixed
  proposer: string; // an agent id, or SYSTEM_ACTOR
};

export type DecisionBallotPayload = {
  decisionId: string;
  voter: string;
  approve: boolean;
};

export type DecisionResolvedPayload = {
  decisionId: string;
  outcome: DecisionOutcome;
};

/** A decision as folded from the log. Resolved ones are KEPT (history / observation). */
export interface DecisionRecord {
  readonly id: string; // = String(openedAtSeq): globally unique, deterministic, no clock/RNG
  readonly regionId: string;
  readonly action: GovernanceAction;
  readonly mechanism: DecisionMechanism;
  readonly proposer: string;
  readonly openedAtSeq: number;
  readonly ballots: Readonly<Record<string, boolean>>; // voter -> approve (last write wins)
  readonly outcome: DecisionOutcome;
}

// --- builders (convenience; villages are still just data) ----------------

export function makeInstitutions(partial: Partial<Institutions> = {}): Institutions {
  return {
    schemaLedger: partial.schemaLedger ?? [],
    verificationPolicy: partial.verificationPolicy ?? { acceptedSchemaIds: [], rejectUnknownSchemas: true },
    diplomacyPolicy: partial.diplomacyPolicy ?? { defaultStance: "reexamine", overrides: {} },
    // Default = the status quo, now made explicit: only the god hand may act, and a
    // single system act decides. This is exactly the pre-T1 behavior, expressed as data.
    decisionMechanism: partial.decisionMechanism ?? systemFiatMechanism(),
  };
}

// --- governance form builders (forms are still just data) ----------------

/** The default form: SYSTEM_ACTOR proposes and a single system act decides (the pre-T1 god hand). */
export function systemFiatMechanism(): DecisionMechanism {
  return {
    proposalRule: { kind: "system" },
    eligibilityRule: { kind: "system" },
    weightingRule: { kind: "equal" },
    selectionRule: { kind: "singleAuthority" },
    executionRule: { kind: "system" },
    vetoRule: null,
    appealRule: null,
    emergencyRule: { kind: "system" },
  };
}

/** Autocracy: a single named authority proposes and decides on its own (immediate). */
export function dictatorshipMechanism(authorityId: string): DecisionMechanism {
  const authority: Qualifier = { kind: "agent", id: authorityId };
  return {
    proposalRule: authority,
    eligibilityRule: authority,
    weightingRule: { kind: "equal" },
    selectionRule: { kind: "singleAuthority" },
    executionRule: { kind: "system" },
    vetoRule: null,
    appealRule: null,
    emergencyRule: authority,
  };
}

/** Council: any of N members may propose; M approving ballots from the N decide (M-of-N). */
export function councilMechanism(memberIds: readonly string[], approvals: number): DecisionMechanism {
  const council: Qualifier = { kind: "group", ids: memberIds };
  return {
    proposalRule: council,
    eligibilityRule: council,
    weightingRule: { kind: "equal" },
    selectionRule: { kind: "threshold", approvals },
    executionRule: { kind: "system" },
    vetoRule: null,
    appealRule: null,
    emergencyRule: null,
  };
}

export function defineRegion(id: string, displayName: string, institutions: Institutions = makeInstitutions()): RegionDefinition {
  return { id, displayName, institutions };
}
