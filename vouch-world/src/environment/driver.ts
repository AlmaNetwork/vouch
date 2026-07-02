// Layer 4 Environment — the simulation driver: brains -> journal -> execute (audit G6).
//
// LIVE-only orchestration. Per tick, for each agent it builds a frozen ReadOnlyView,
// calls the brain, JOURNALS the returned intent (agent.decided), then EXECUTES it
// through the environment write path. Replay never runs this — it just re-folds the
// journaled events — so swapping a rule-based brain for an LLM stays deterministic.
//
// It also runs the §3-D internal-emergence trigger: when a cohort whose value
// profile clashes with its region reaches critical mass, it secedes by calling the
// SAME founding engine (an emergence proposer), then migrates there.

import type { KeyPair } from "vouch-core";
import {
  type AgentDecidedPayload,
  type AgentRole,
  agentsInRegion,
  type Brain,
  defaultBrains,
  EVENT_AGENT_DECIDED,
  getAgent,
  type Intent,
  listAgents,
  type ReadOnlyView,
} from "../agent";
import type { Rng, World } from "../foundation";
import { getRegion, listRegions } from "../region";
import { executeTransfer } from "./economy";
import { detectEmergence } from "./emergence";
import { immigrate } from "./population";
import { regenerateResources } from "./resource";
import type { WorldState } from "./state";

const DEFAULT_CRITICAL_MASS = 3;

export interface EconomyConfig {
  readonly brains?: Partial<Record<AgentRole, Brain>>;
  readonly notary: KeyPair;
  readonly criticalMass?: number;
}

function dispatchIntent(env: World<WorldState>, agentId: string, intent: Intent, tick: number, notary: KeyPair): void {
  try {
    if (intent.kind === "transfer") {
      executeTransfer(env, { from: agentId, to: intent.to, amount: intent.amount }, { tick, notary });
    } else if (intent.kind === "emigrate") {
      immigrate(env, agentId, intent.to);
    }
    // idle: nothing
  } catch {
    // An invalid action (e.g. a cross-region transfer = M4) is simply skipped by the driver.
  }
}

/** One simulation tick: every agent decides (journaled) and acts, then emergence is checked. */
export function economyStep(env: World<WorldState>, ctx: { tick: number; rng: Rng }, config: EconomyConfig): void {
  const brains = config.brains ?? defaultBrains;
  // Deterministic order: snapshot the resident ids (treasuries don't act), sorted.
  const ids = listAgents(env.getState())
    .filter((a) => a.role !== "treasury")
    .map((a) => a.id)
    .sort();

  for (const id of ids) {
    const state = env.getState();
    const self = getAgent(state, id);
    if (!self) continue;
    const brain = brains[self.role] ?? (() => ({ kind: "idle" }) as Intent);
    const view: ReadOnlyView = {
      tick: ctx.tick,
      self,
      peers: agentsInRegion(state, self.region).filter((p) => p.id !== self.id),
      homeRegion: getRegion(state, self.region),
      otherRegions: listRegions(state).filter((r) => r.id !== self.region),
      roll: ctx.rng.nextFloat(),
    };
    const intent = brain(view);
    // journal the decision (G6); carry the subject id so the journal is self-describing.
    env.emit(EVENT_AGENT_DECIDED, id, { agentId: id, intent } satisfies AgentDecidedPayload);
    dispatchIntent(env, id, intent, ctx.tick, config.notary);
  }

  // P3: produce into each region's resource pool for this tick (id-sorted, deterministic).
  for (const r of listRegions(env.getState()).sort((a, b) => (a.id < b.id ? -1 : 1))) regenerateResources(env, r.id);

  detectEmergence(env, config.criticalMass ?? DEFAULT_CRITICAL_MASS);
}

/** Drive `ticks` simulation ticks over a world (tick loop + brains + emergence). */
export function runEconomy(world: World<WorldState>, ticks: number, config: EconomyConfig): void {
  world.run(ticks, (ctx) => economyStep(world, { tick: ctx.tick, rng: ctx.rng }, config));
}
