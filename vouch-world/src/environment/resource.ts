// Layer 4 Environment — region RESOURCES (P3 scarcity, the "competition" substrate).
//
// Each region holds a finite pool that is PRODUCED into per tick (regenerateResources, driven
// each tick by the driver) and DRAWN from by its residents (drawResource). When the pool is
// depleted, late drawers fail — that scarcity is the competition. A draw is conserved: the
// amount moves pool -> agent in one env-authored event (folded by both the region and agent
// reducers). Env-authored + reducer-gated like every other state change.

import { getAgent } from "../agent";
import type { Result } from "../foundation";
import { EVENT_RESOURCE_DRAWN, EVENT_RESOURCE_REGENERATED, getRegion } from "../region";
import type { WorldCommit } from "./state";

export type ResourceResult = Result;

/** Produce into a region's pool, up to capacity. A no-op for a region with no pool or a full one. */
export function regenerateResources(env: WorldCommit, regionId: string): ResourceResult {
  const region = getRegion(env.getState(), regionId);
  if (!region) return { ok: false, reason: "unknown-region" };
  const { capacity, regenPerTick } = region.institutions.resourcePolicy;
  const amount = Math.min(regenPerTick, capacity - region.resourceLevel);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: true }; // nothing to add (or a poisoned/full pool)
  env.commitSystem(EVENT_RESOURCE_REGENERATED, { regionId, amount });
  return { ok: true };
}

/** An agent DRAWS from its region's active pool (pool -> agent). Fails if the pool is too low (scarcity). */
export function drawResource(env: WorldCommit, agentId: string, amount: number): ResourceResult {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: "bad-amount" };
  const state = env.getState();
  const agent = getAgent(state, agentId);
  if (!agent) return { ok: false, reason: "unknown-agent" };
  const region = getRegion(state, agent.region);
  if (!region) return { ok: false, reason: "unknown-region" };
  if (region.lifecycle !== "active") return { ok: false, reason: "region-dormant" };
  if (region.resourceLevel < amount) return { ok: false, reason: "insufficient-resource" }; // SCARCITY
  env.commitSystem(EVENT_RESOURCE_DRAWN, { regionId: agent.region, agentId, amount });
  return { ok: true };
}
