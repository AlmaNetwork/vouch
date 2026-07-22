// Layer 4 Environment — RFC 0007 §9 sanction primitives: suspendId / reinstateId.
//
// Structured as the three layers RFC 0007 §6 will formalize, so the command-system BODY can
// be layered on later WITHOUT rewriting this file (design decision — keep the seam):
//
//   §6  authorization checkpoint   canSanction(state, target, by)          — WHO may act
//   §3.4 effect primitives         applySuspension / applyReinstatement     — WHAT happens (auth-free)
//   public write ops               suspendAgent / reinstateAgent = authorize + effect
//
// When dispatchCommand (§6) lands it becomes the composer — resolve a CommandDefinition,
// evaluate its authorization predicate, then run effect primitives BY NAME. The primitives
// below are that catalog: they take no `by` and make no judgement. The public ops stay as
// thin convenience wrappers (or delegate to the dispatcher).
//
// Sanctions are SYSTEM_ACTOR-authored (commit -> commitSystem); a forged sanction is rejected
// at write time and again by the reducer actor-gate.
//
// Tier K-5: suspension never blocks emigration — emigrate is dispatched via immigrate()
// (population.ts), not executeTransfer, so it is unaffected here.

import { parseIdentifier } from "vouch-core";
import { type AgentState, EVENT_AGENT_REINSTATED, EVENT_AGENT_SUSPENDED, getAgent } from "../agent";
import type { Result } from "../foundation";
import { canGovern, getRegion } from "../region";
import { commit, type WorldCommit, type WorldState } from "./state";

export type SuspendResult = Result<{ untilTick: number }>;
export type ReinstateResult = Result;

// --- §6 authorization checkpoint -----------------------------------------

/**
 * May `by` sanction `target`? Dual-authority model (design decision): a sanction is authorized
 * if `by` governs EITHER the target's CITIZENSHIP region (its id's `@region`) OR its current
 * RESIDENCE region — `canGovern` under each (dictatorship owner / council member; a single
 * council member suffices, P2). The two-authority conflict (both could act, or disagree) is
 * deferred; today any single qualifying authority is enough. This function is the seam the §6
 * command-authorization predicate will generalize (role / standing / capability).
 */
function canSanction(state: WorldState, target: AgentState, by: string): boolean {
  const citizenship = parseIdentifier(target.id)?.region;
  // citizenship (id) and residence may differ after migration — check both, de-duplicated.
  const regionIds = citizenship && citizenship !== target.region ? [citizenship, target.region] : [target.region];
  for (const regionId of regionIds) {
    const region = getRegion(state, regionId);
    if (region && canGovern(region, by)) return true;
  }
  return false;
}

// --- §3.4 effect primitives (auth-free; the future command catalog) ------

/** §3.4 effect `suspend`: set the suspension window. Authorization is the caller's concern. */
function applySuspension(env: WorldCommit, agentId: string, untilTick: number): void {
  commit(env, EVENT_AGENT_SUSPENDED, { agentId, untilTick });
}

/** §3.4 effect `reinstate`: clear the suspension. Authorization is the caller's concern. */
function applyReinstatement(env: WorldCommit, agentId: string): void {
  commit(env, EVENT_AGENT_REINSTATED, { agentId });
}

// --- public write ops = authorize + effect -------------------------------

/**
 * RFC 0007 §9 suspendId: suspend `agentId`'s economy participation until `untilTick`
 * (inclusive), on the authority of `by`. A second suspend REPLACES the window (the later
 * sentence wins). Reasons: `bad-until-tick`, `unknown-agent`, `not-authorized`.
 */
export function suspendAgent(env: WorldCommit, agentId: string, untilTick: number, by: string): SuspendResult {
  if (!Number.isInteger(untilTick) || untilTick < 0) return { ok: false, reason: "bad-until-tick" };
  const target = getAgent(env.getState(), agentId);
  if (!target) return { ok: false, reason: "unknown-agent" };
  if (!canSanction(env.getState(), target, by)) return { ok: false, reason: "not-authorized" };
  applySuspension(env, agentId, untilTick);
  return { ok: true, untilTick };
}

/**
 * RFC 0007 §9 reinstateId: lift `agentId`'s suspension early, on the authority of `by`.
 * Idempotent (returns ok even if not currently suspended — the reducer no-ops).
 * Reasons: `unknown-agent`, `not-authorized`.
 */
export function reinstateAgent(env: WorldCommit, agentId: string, by: string): ReinstateResult {
  const target = getAgent(env.getState(), agentId);
  if (!target) return { ok: false, reason: "unknown-agent" };
  if (!canSanction(env.getState(), target, by)) return { ok: false, reason: "not-authorized" };
  applyReinstatement(env, agentId);
  return { ok: true };
}
