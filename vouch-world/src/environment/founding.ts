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
import type { CommitSink } from "../foundation";
import {
  EVENT_GOV_PROPOSAL_OPENED,
  EVENT_GOV_VOTE_CAST,
  EVENT_REGION_FOUNDED,
  EVENT_REGION_INSTITUTION_CHANGED,
  type FoundingProposal,
  type InstitutionChange,
  type Proposer,
  type RecognitionStatus,
  type RegionDefinition,
  type RegionState,
  canGovern,
  getRegion,
  validateEconomyPolicy,
  validateGovernance,
  validateResourcePolicy,
} from "../region";
import type { WorldState } from "./state";

type Commit = CommitSink<WorldState>;

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
export function proposeFounding(env: Commit, proposal: FoundingProposal): RegionState {
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
  const founded = getRegion(env.getState(), definition.id);
  if (!founded) throw new Error("founding: invariant violated — region not present after founding event");
  return founded;
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
export function emergenceProposal(definition: RegionDefinition, sourceRegion: string, reason: string, cohort: readonly string[]): FoundingProposal {
  // A seceded region is system/unowned at birth; the market or a claim assigns an owner later.
  return { definition, proposer: { kind: "emergence", sourceRegion, reason, cohort }, owner: null };
}

/** Seed the genesis villages (born recognized) through the same execution engine. System-owned. */
export function seedGenesis(env: Commit, definitions: readonly RegionDefinition[]): RegionState[] {
  return definitions.map((definition) => proposeFounding(env, { definition, proposer: { kind: "genesis" }, owner: null }));
}

// --- legislator (§8): institutions are swappable, every change is logged + AUTHORIZED ---
//
// The owner-scoped governance gate (the once-deferred provenance gating, audit G8).
// An amendment to region R is honored ONLY if the acting principal `by` satisfies R's
// governance (dictatorship → the owner; council → a member; see canGovern). This is the
// "valve" — now OPEN but gated: a participant can rewrite ONLY the rules of a region they
// govern, including its governance itself (a dictator may open a council). Quorum/vote for
// council decisions is P3; in P2 a single authorized principal may amend.

export function amendInstitution(env: Commit, regionId: string, change: InstitutionChange, by: string): RegionState {
  const region = getRegion(env.getState(), regionId);
  if (!region) throw new Error(`amendInstitution: region "${regionId}" does not exist`);
  // Council-governed regions decide collectively — a single member may NOT amend directly.
  if (region.institutions.governance.kind === "council") {
    throw new Error(`amendInstitution: region "${regionId}" is council-governed — use openProposal/castVote`);
  }
  if (!canGovern(region, by)) {
    throw new Error(`amendInstitution: "${by}" may not amend region "${regionId}" under its ${region.institutions.governance.kind} governance`);
  }
  // A constitutional change must leave the region governable (no empty-council brick, and no
  // owner-null dictatorship); an economy change must stay within bounds (no fee > amount / negative).
  if (change.policy === "governance") {
    validateGovernance(change.value);
    if (change.value.kind === "dictatorship" && region.owner === null) {
      throw new Error(`amendInstitution: a system-owned (owner-null) region cannot become a dictatorship — it would be ungovernable`);
    }
  }
  if (change.policy === "economy") validateEconomyPolicy(change.value);
  if (change.policy === "resource") validateResourcePolicy(change.value);

  env.commitSystem(EVENT_REGION_INSTITUTION_CHANGED, { regionId, change, by });

  const updated = getRegion(env.getState(), regionId);
  if (!updated) throw new Error("amendInstitution: invariant violated");
  return updated;
}

// --- council voting (§8, P3): collective amendments via proposal + votes -------------
//
// A council-governed region amends through a PROPOSAL that APPLIES once `threshold` members
// have voted (the proposer's open counts as the first vote, so a threshold-1 council resolves
// at once). Resolution happens in the region reducer when the vote count crosses threshold,
// so it replays deterministically. The change is validated here, at propose time.

export function openProposal(env: Commit, regionId: string, change: InstitutionChange, by: string): RegionState {
  const region = getRegion(env.getState(), regionId);
  if (!region) throw new Error(`openProposal: region "${regionId}" does not exist`);
  if (region.institutions.governance.kind !== "council") throw new Error(`openProposal: region "${regionId}" is not council-governed`);
  if (!canGovern(region, by)) throw new Error(`openProposal: "${by}" is not a council member of region "${regionId}"`);
  if (region.openProposal) throw new Error(`openProposal: region "${regionId}" already has an open proposal`);
  if (change.policy === "governance") {
    validateGovernance(change.value);
    // an owner-null region made a dictatorship would be ungovernable forever (same brick as an
    // empty council) — a council may not vote itself into that state.
    if (change.value.kind === "dictatorship" && region.owner === null) {
      throw new Error(`openProposal: a system-owned (owner-null) region cannot become a dictatorship — it would be ungovernable`);
    }
  }
  if (change.policy === "economy") validateEconomyPolicy(change.value);
  if (change.policy === "resource") validateResourcePolicy(change.value);
  env.commitSystem(EVENT_GOV_PROPOSAL_OPENED, { regionId, change, by });
  const updated = getRegion(env.getState(), regionId);
  if (!updated) throw new Error("openProposal: invariant violated");
  return updated;
}

export function castVote(env: Commit, regionId: string, voter: string): RegionState {
  const region = getRegion(env.getState(), regionId);
  if (!region) throw new Error(`castVote: region "${regionId}" does not exist`);
  if (!region.openProposal) throw new Error(`castVote: region "${regionId}" has no open proposal`);
  if (!canGovern(region, voter)) throw new Error(`castVote: "${voter}" is not a council member of region "${regionId}"`);
  if (region.openProposal.votes.includes(voter)) throw new Error(`castVote: "${voter}" already voted`);
  env.commitSystem(EVENT_GOV_VOTE_CAST, { regionId, voter });
  const updated = getRegion(env.getState(), regionId);
  if (!updated) throw new Error("castVote: invariant violated");
  return updated;
}
