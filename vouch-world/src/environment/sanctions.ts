// Layer 4 Environment — RFC 0007 §9 sanction primitives: suspendId / reinstateId.
//
// Sanctions are SYSTEM_ACTOR-only (Tier K guard via commitSystem / commit) — the only
// path that produces agent.suspended / agent.reinstated events. Agents receive an
// Intent and the environment decides; a suspension is a unilateral governance act, not
// something an agent can request for itself.
//
// Tier K-5: suspension never blocks emigration — emigrate is dispatched via immigrate()
// in population.ts (not executeTransfer), so it is automatically unaffected here.

import { EVENT_AGENT_REINSTATED, EVENT_AGENT_SUSPENDED, getAgent } from "../agent";
import type { Result } from "../foundation";
import { commit, type WorldCommit } from "./state";

export type SuspendResult = Result<{ untilTick: number }>;
export type ReinstateResult = Result;

/**
 * RFC 0007 §9 suspendId: suspend an agent's economy participation until `untilTick`
 * (inclusive). A second call REPLACES the previous window (the later sentence wins).
 * Returns `{ok:false, reason:"unknown-agent"}` for a missing agent and
 * `{ok:false, reason:"bad-until-tick"}` for non-integer or negative ticks.
 */
export function suspendAgent(env: WorldCommit, agentId: string, untilTick: number): SuspendResult {
  if (!Number.isInteger(untilTick) || untilTick < 0) return { ok: false, reason: "bad-until-tick" };
  if (!getAgent(env.getState(), agentId)) return { ok: false, reason: "unknown-agent" };
  commit(env, EVENT_AGENT_SUSPENDED, { agentId, untilTick });
  return { ok: true, untilTick };
}

/**
 * RFC 0007 §9 reinstateId: lift an active suspension immediately.
 * No-op at the reducer level if the agent is not suspended, but returns {ok:true}
 * either way (idempotent governance decision). Returns `{ok:false, reason:"unknown-agent"}`
 * for a missing agent.
 */
export function reinstateAgent(env: WorldCommit, agentId: string): ReinstateResult {
  if (!getAgent(env.getState(), agentId)) return { ok: false, reason: "unknown-agent" };
  commit(env, EVENT_AGENT_REINSTATED, { agentId });
  return { ok: true };
}
