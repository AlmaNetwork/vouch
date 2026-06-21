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
import { SYSTEM_ACTOR, type CommitSink } from "../foundation";
import {
  EVENT_REGION_FOUNDED,
  EVENT_REGION_INSTITUTION_CHANGED,
  type FoundingProposal,
  type InstitutionChange,
  type Proposer,
  type RecognitionStatus,
  type RegionDefinition,
  type RegionState,
  getRegion,
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
  const { definition, proposer } = proposal;

  if (!isValidRegion(definition.id)) {
    throw new Error(`founding: invalid region id "${definition.id}" (must be lowercase alphanumeric)`);
  }
  if (getRegion(env.getState(), definition.id)) {
    throw new Error(`founding: region "${definition.id}" already exists`);
  }

  env.emit(EVENT_REGION_FOUNDED, SYSTEM_ACTOR, {
    region: definition,
    proposer,
    status: birthStatus(proposer),
  });

  // The reducer has folded the event; read back the resulting region.
  const founded = getRegion(env.getState(), definition.id);
  if (!founded) throw new Error("founding: invariant violated — region not present after founding event");
  return founded;
}

// --- proposal constructors: both flow into the one engine above ----------

/** (a) external injection — the experimenter founds a village mid-run (god view; sim-only). */
export function experimenterProposal(definition: RegionDefinition, note?: string): FoundingProposal {
  return { definition, proposer: { kind: "experimenter", note } };
}

/**
 * (b) internal emergence — reserved for M3+. No auto-trigger yet; this constructor
 * exists so the SAME engine can be driven by an emergence proposer the moment agents
 * exist. Calling it today simply proves the entry point is shared.
 */
export function emergenceProposal(definition: RegionDefinition, sourceRegion: string, reason: string, cohort: readonly string[]): FoundingProposal {
  return { definition, proposer: { kind: "emergence", sourceRegion, reason, cohort } };
}

/** Seed the genesis villages (born recognized) through the same execution engine. */
export function seedGenesis(env: Commit, definitions: readonly RegionDefinition[]): RegionState[] {
  return definitions.map((definition) => proposeFounding(env, { definition, proposer: { kind: "genesis" } }));
}

// --- legislator plumbing (§8): institutions are swappable + every change is logged ---
//
// The future viewer-voting hook. The MECHANISM exists (function + event + reducer
// case) so institutions can be replaced and the change is part of the immutable
// history. There is deliberately NO external UI/API and nothing auto-calls this —
// the tap is plumbed, the valve is shut (§8, §2-9). NOTE (audit G8, deferred to
// M3): provenance gating (only collective-origin proposers may amend) belongs at
// the reducer fold point, since World.emit is public.

export function amendInstitution(env: Commit, regionId: string, change: InstitutionChange, proposer: Proposer): RegionState {
  const region = getRegion(env.getState(), regionId);
  if (!region) throw new Error(`amendInstitution: region "${regionId}" does not exist`);

  env.emit(EVENT_REGION_INSTITUTION_CHANGED, SYSTEM_ACTOR, { regionId, change, proposer });

  const updated = getRegion(env.getState(), regionId);
  if (!updated) throw new Error("amendInstitution: invariant violated");
  return updated;
}
