// Layer 4 Environment — the decision ENGINE (the governance write path, T1).
//
// This is where a Region's DecisionMechanism (carried as data in its institutions)
// actually drives an outcome. The flow mirrors founding's propose/execute split:
//
//   openDecision  — check the proposalRule, record decision.opened (snapshotting
//                   the mechanism so the decision's meaning can't drift mid-flight)
//   castBallot    — check the eligibilityRule, record decision.ballot, then try to resolve
//   tryResolve    — a PURE fold of the snapshot mechanism over the accumulated
//                   ballots; if decided, record decision.resolved and, when approved,
//                   EXECUTE the action through the engine that already exists
//                   (amendInstitution / recognizeRegion), always via SYSTEM_ACTOR.
//
// Determinism: no clock; the id is the log seq; resolution reads only folded state.
// The two MVP forms (singleAuthority, threshold) need no randomness, so the engine
// takes the narrow CommitSink (audit G3) and never touches the RNG. The RNG-driven
// forms (sortition / randomBeacon) are typed but deliberately not wired yet.
//
// The engine itself NEVER mutates state — it only emits, so the reducer stays the
// chokepoint (§2-5). Provenance gating (e.g. forbidding a raw amendInstitution that
// did NOT come through an approved decision) is the T2 hook and is left as data the
// authority checks will read, not enforced here.

import { SYSTEM_ACTOR, type CommitSink } from "../foundation";
import { getAgent } from "../agent";
import {
  EVENT_DECISION_BALLOT,
  EVENT_DECISION_OPENED,
  EVENT_DECISION_RESOLVED,
  type DecisionMechanism,
  type DecisionOutcome,
  type DecisionRecord,
  type GovernanceAction,
  type Qualifier,
  type Weighting,
  getDecision,
  getRegion,
} from "../region";
import { amendInstitution } from "./founding";
import { recognizeRegion } from "./diplomacy";
import type { WorldState } from "./state";

type Commit = CommitSink<WorldState>;

/**
 * Evaluate a Qualifier for `actorId` (an agent id, or SYSTEM_ACTOR) in `regionId`.
 * The ONE predicate the decision engine and the future T2 authority checks share.
 */
export function evaluateQualifier(state: WorldState, regionId: string, actorId: string, q: Qualifier): boolean {
  switch (q.kind) {
    case "anyone":
      return true;
    case "system":
      return actorId === SYSTEM_ACTOR;
    case "agent":
      return actorId === q.id;
    case "group":
      return q.ids.includes(actorId);
    case "role": {
      const a = getAgent(state, actorId);
      return !!a && a.role === q.role;
    }
    case "reputationAtLeast": {
      const a = getAgent(state, actorId);
      return !!a && a.reputation >= q.min;
    }
    case "resident": {
      const a = getAgent(state, actorId);
      return !!a && a.region === regionId;
    }
    case "all":
      return q.of.every((sub) => evaluateQualifier(state, regionId, actorId, sub));
    case "any":
      return q.of.some((sub) => evaluateQualifier(state, regionId, actorId, sub));
  }
}

/** A participant's weight under the mechanism's weighting rule. */
function weightOf(state: WorldState, actorId: string, w: Weighting): number {
  if (w.kind === "equal") return 1;
  const a = getAgent(state, actorId);
  if (!a) return 0;
  switch (w.kind) {
    case "reputation":
      return Math.max(0, a.reputation);
    case "stakeCurrency":
      return Math.max(0, a.balances.currency);
    case "stakeCredit":
      return Math.max(0, a.balances.credit);
  }
}

/** Pure: does the accumulated ballot set satisfy the selection rule yet? */
function evaluateOutcome(state: WorldState, d: DecisionRecord): DecisionOutcome {
  const approvers = Object.entries(d.ballots)
    .filter(([, approve]) => approve)
    .map(([voter]) => voter);
  const sel = d.mechanism.selectionRule;
  switch (sel.kind) {
    case "singleAuthority":
      return approvers.length >= 1 ? "approved" : "open";
    case "threshold":
      return approvers.length >= sel.approvals ? "approved" : "open";
    case "weightedFraction": {
      // Fraction of CAST weight (engine does not enumerate a full electorate yet).
      const castWeight = Object.keys(d.ballots).reduce((sum, v) => sum + weightOf(state, v, d.mechanism.weightingRule), 0);
      if (castWeight <= 0) return "open";
      const approveWeight = approvers.reduce((sum, v) => sum + weightOf(state, v, d.mechanism.weightingRule), 0);
      return approveWeight / castWeight >= sel.min ? "approved" : "open";
    }
    case "sortition":
    case "randomBeacon":
      // Typed for the general form; wiring needs the engine RNG (reserved, like the
      // founding emergence trigger). Fail loudly rather than silently mis-resolve.
      throw new Error(`decision: selectionRule "${sel.kind}" is reserved for a later milestone (needs the engine RNG)`);
  }
}

/** Execute an approved action through the engine that already owns that write. */
function executeAction(env: Commit, d: DecisionRecord): void {
  const action = d.action;
  switch (action.kind) {
    case "amendInstitution":
      // The decision is the origin; record it on the amendment's proposer note.
      amendInstitution(env, d.regionId, action.change, { kind: "experimenter", note: `decision:${d.id}` });
      return;
    case "recognizeRegion":
      recognizeRegion(env, d.regionId, action.target);
      return;
  }
}

/**
 * Open a decision in `regionId`: the proposer must satisfy the region's proposalRule.
 * Records `decision.opened` (with a snapshot of the current mechanism) and returns
 * the new record — read back from the just-folded state, keyed by its log seq.
 */
export function openDecision(env: Commit, regionId: string, action: GovernanceAction, proposer: string): DecisionRecord {
  const state = env.getState();
  const region = getRegion(state, regionId);
  if (!region) throw new Error(`openDecision: region "${regionId}" does not exist`);

  const mechanism = region.institutions.decisionMechanism;
  if (!evaluateQualifier(state, regionId, proposer, mechanism.proposalRule)) {
    throw new Error(`openDecision: "${proposer}" may not propose in "${regionId}"`);
  }

  const ev = env.emit(EVENT_DECISION_OPENED, proposer, { regionId, action, mechanism, proposer });
  const opened = getDecision(env.getState(), String(ev.seq));
  if (!opened) throw new Error("openDecision: invariant violated — decision not present after open event");
  return opened;
}

/**
 * Cast a ballot on an open decision: the voter must satisfy the eligibilityRule.
 * Records `decision.ballot`, then attempts resolution. Returns the latest record.
 */
export function castBallot(env: Commit, decisionId: string, voter: string, approve: boolean): DecisionRecord {
  const before = getDecision(env.getState(), decisionId);
  if (!before) throw new Error(`castBallot: decision "${decisionId}" does not exist`);
  if (before.outcome !== "open") throw new Error(`castBallot: decision "${decisionId}" is already ${before.outcome}`);
  if (!evaluateQualifier(env.getState(), before.regionId, voter, before.mechanism.eligibilityRule)) {
    throw new Error(`castBallot: "${voter}" is not eligible to vote on "${decisionId}"`);
  }

  env.emit(EVENT_DECISION_BALLOT, voter, { decisionId, voter, approve });
  return tryResolve(env, decisionId);
}

/**
 * Evaluate an open decision against its snapshot mechanism. If it has been decided,
 * record `decision.resolved` and, when approved, execute the action. Idempotent on
 * already-resolved decisions. Returns the latest record.
 */
export function tryResolve(env: Commit, decisionId: string): DecisionRecord {
  const d = getDecision(env.getState(), decisionId);
  if (!d) throw new Error(`tryResolve: decision "${decisionId}" does not exist`);
  if (d.outcome !== "open") return d;

  const outcome = evaluateOutcome(env.getState(), d);
  if (outcome === "open") return d;

  env.emit(EVENT_DECISION_RESOLVED, SYSTEM_ACTOR, { decisionId, outcome });
  if (outcome === "approved") executeAction(env, d);

  const after = getDecision(env.getState(), decisionId);
  if (!after) throw new Error("tryResolve: invariant violated");
  return after;
}
