// Layer 2 Region — the decision read-model slice + its reducer + selectors (T1).
//
// A decision is a governance act in flight: opened with a snapshot of the
// region's DecisionMechanism, then ballots accumulate, then it resolves. State is
// pure fold — like every other slice, region imports only foundation here. The
// ENGINE that evaluates a mechanism and EXECUTES an approved action is the write
// path, so it lives one layer up in environment/ (audit G2).

import type { Reducer } from "../foundation";
import {
  EVENT_DECISION_BALLOT,
  EVENT_DECISION_OPENED,
  EVENT_DECISION_RESOLVED,
  type DecisionBallotPayload,
  type DecisionOpenedPayload,
  type DecisionRecord,
  type DecisionResolvedPayload,
} from "./types";

/** The decision read-model slice of world state. The environment composes this in. */
export type DecisionSlice = { readonly decisions: Readonly<Record<string, DecisionRecord>> };

/** Folds decision-lifecycle events into the decision slice. Ignores everything else. */
export const decisionReducer: Reducer<DecisionSlice> = (state, event) => {
  switch (event.type) {
    case EVENT_DECISION_OPENED: {
      const p = event.payload as DecisionOpenedPayload;
      // id = the global log seq: unique and deterministic, with no clock or RNG.
      const id = String(event.seq);
      const record: DecisionRecord = {
        id,
        regionId: p.regionId,
        action: p.action,
        mechanism: p.mechanism,
        proposer: p.proposer,
        openedAtSeq: event.seq,
        ballots: {},
        outcome: "open",
      };
      return { ...state, decisions: { ...state.decisions, [id]: record } };
    }
    case EVENT_DECISION_BALLOT: {
      const p = event.payload as DecisionBallotPayload;
      const existing = state.decisions[p.decisionId];
      if (!existing || existing.outcome !== "open") return state; // ballots only count while open
      const ballots = { ...existing.ballots, [p.voter]: p.approve }; // last write wins
      return { ...state, decisions: { ...state.decisions, [p.decisionId]: { ...existing, ballots } } };
    }
    case EVENT_DECISION_RESOLVED: {
      const p = event.payload as DecisionResolvedPayload;
      const existing = state.decisions[p.decisionId];
      if (!existing || existing.outcome !== "open") return state;
      return { ...state, decisions: { ...state.decisions, [p.decisionId]: { ...existing, outcome: p.outcome } } };
    }
    default:
      return state;
  }
};

// --- selectors (read-only) ------------------------------------------------

export function getDecision(state: DecisionSlice, id: string): DecisionRecord | undefined {
  return state.decisions[id];
}

export function listDecisions(state: DecisionSlice): DecisionRecord[] {
  return Object.values(state.decisions);
}

export function openDecisionsOf(state: DecisionSlice, regionId: string): DecisionRecord[] {
  return listDecisions(state).filter((d) => d.regionId === regionId && d.outcome === "open");
}
