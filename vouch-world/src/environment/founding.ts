// Layer 4 Environment — the founding EXECUTION engine (the sanctioned write path).
//
// Hoisted out of region/ (audit G2/G3): founding is a WRITE operation, so it
// belongs to the environment layer that owns the write path. Region keeps only
// the vocabulary (FoundingProposal / Proposer / Institutions / regionReducer).
//
// The engine takes a narrow CommitSink ({ getState, emit }) — NOT the whole World
// — so no future caller (e.g. an M3 agent brain) inherits rng / advanceTick / run
// / log through this signature (audit G3). The propose/execute split (§2-B) is
// unchanged: one engine, one FoundingProposal interface, every proposer equal.

import { isValidRegion } from "vouch-core"; // the extracted Trust Core, consumed as a dependency
import {
  EVENT_REGION_FOUNDED,
  type FoundingProposal,
  getRegion,
  type Proposer,
  type RecognitionStatus,
  type RegionDefinition,
  type RegionState,
  validateEconomyPolicy,
  validateGovernance,
  validateResourcePolicy,
} from "../region";
import { readBackOrThrow, type WorldCommit } from "./state";

/** Genesis villages are born recognized (they ARE the established society); all others unrecognized. */
function birthStatus(proposer: Proposer): RecognitionStatus {
  return proposer.kind === "genesis" ? "recognized" : "unrecognized";
}

/**
 * The founding EXECUTION ENGINE. Validates, then records a `region.founded`
 * event. The village is added with its initial institutions, born unrecognized
 * (unless genesis), with no residents yet — immigration is M3 (§2-B). Returns it.
 *
 * The interaction goes through the world engine (§2-5): state changes only by the
 * emitted event being folded — nothing is mutated directly.
 */
export function proposeFounding(env: WorldCommit, proposal: FoundingProposal): RegionState {
  const { definition, proposer, owner } = proposal;

  if (!isValidRegion(definition.id)) {
    throw new Error(`founding: invalid region id "${definition.id}" (must be lowercase alphanumeric)`);
  }
  if (getRegion(env.getState(), definition.id)) {
    throw new Error(`founding: region "${definition.id}" already exists`);
  }
  // Validate the institutions at founding too: makeInstitutions validates, but a hand-built
  // Institutions literal would otherwise install a degenerate policy that bypasses every
  // amend-time check (e.g. an empty council, a fee > amount, a NaN resource capacity).
  validateGovernance(definition.institutions.governance);
  validateEconomyPolicy(definition.institutions.economyPolicy);
  validateResourcePolicy(definition.institutions.resourcePolicy);

  env.commitSystem(EVENT_REGION_FOUNDED, {
    region: definition,
    proposer,
    status: birthStatus(proposer),
    owner,
  });

  // The reducer has folded the event; read back the resulting region.
  return readBackOrThrow("founding", getRegion(env.getState(), definition.id));
}

// --- proposal constructors: both flow into the one engine above ----------

/**
 * (a) external injection — the experimenter founds a village mid-run (god view; sim-only).
 * `owner` is the account/ID that will GOVERN the region (null = system/unowned). This is the
 * path a human participant founds-and-governs through; an ID may found MULTIPLE regions
 * (the Sybil rule is 1 person = 1 ID, and an ID can be resident and/or founder).
 */
export function experimenterProposal(definition: RegionDefinition, note?: string, owner: string | null = null): FoundingProposal {
  return { definition, proposer: { kind: "experimenter", note }, owner };
}

/**
 * (b) internal emergence — reserved for M3+. No auto-trigger yet; this constructor
 * exists so the SAME engine can be driven by an emergence proposer the moment agents
 * exist. Calling it today simply proves the entry point is shared.
 */
export function emergenceProposal(
  definition: RegionDefinition,
  sourceRegion: string,
  reason: string,
  cohort: readonly string[],
): FoundingProposal {
  // A seceded region is system/unowned at birth; the market or a claim assigns an owner later.
  return { definition, proposer: { kind: "emergence", sourceRegion, reason, cohort }, owner: null };
}

/** Seed the genesis villages (born recognized) through the same execution engine. System-owned. */
export function seedGenesis(env: WorldCommit, definitions: readonly RegionDefinition[]): RegionState[] {
  return definitions.map((definition) => proposeFounding(env, { definition, proposer: { kind: "genesis" }, owner: null }));
}
