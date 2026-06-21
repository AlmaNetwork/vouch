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
  EVENT_AGENT_DECIDED,
  type AgentDecidedPayload,
  type AgentRole,
  type AgentState,
  type Brain,
  type Intent,
  type ReadOnlyView,
  agentsInRegion,
  defaultBrains,
  getAgent,
  listAgents,
} from "../agent";
import { type Rng, type World } from "../foundation";
import { type RegionState, defineRegion, getRegion, listRegions, makeInstitutions } from "../region";
import { executeTransfer } from "./economy";
import { emergenceProposal, proposeFounding } from "./founding";
import { admitTreasury, immigrate } from "./population";
import type { WorldState } from "./state";

const DEFAULT_CRITICAL_MASS = 3;

export interface EconomyConfig {
  readonly brains?: Partial<Record<AgentRole, Brain>>;
  readonly notary: KeyPair;
  readonly criticalMass?: number;
}

/** A region's institutional leaning, derived from its verification policy. */
export function regionStance(region: RegionState): "strict" | "lenient" {
  return region.institutions.verificationPolicy.rejectUnknownSchemas ? "strict" : "lenient";
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

  detectEmergence(env, config.criticalMass ?? DEFAULT_CRITICAL_MASS);
}

/** Drive `ticks` simulation ticks over a world (tick loop + brains + emergence). */
export function runEconomy(world: World<WorldState>, ticks: number, config: EconomyConfig): void {
  world.run(ticks, (ctx) => economyStep(world, { tick: ctx.tick, rng: ctx.rng }, config));
}

/**
 * §3-D internal emergence. Groups dissatisfied agents (value profile != region
 * stance) by (region, profile); any group at/above critical mass SECEDES via the
 * SAME founding engine (audit-confirmed reuse), with institutions embodying the
 * dissatisfaction, then migrates there (which resolves the mismatch).
 *
 * The region is FOUNDED once per (region, profile); a later dissatisfied wave
 * immigrates into the existing region (§3-C) rather than being stranded (EMG-1).
 */
export function detectEmergence(env: World<WorldState>, criticalMass: number): void {
  const state = env.getState();
  const groups = new Map<string, AgentState[]>();
  for (const a of listAgents(state)) {
    if (a.role === "treasury") continue;
    const region = getRegion(state, a.region);
    if (!region) continue;
    if (a.valueProfile === regionStance(region)) continue; // satisfied
    const key = `${a.region}::${a.valueProfile}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(a);
    else groups.set(key, [a]);
  }

  for (const [key, bucket] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (bucket.length < criticalMass) continue;
    const [sourceRegion, profile] = key.split("::") as [string, "strict" | "lenient"];
    // EMG-3: deterministic cohort order (don't lean on Object.values insertion order).
    const cohort = [...bucket].sort((a, b) => (a.id < b.id ? -1 : 1));
    const newId = `${profile}${sourceRegion}`; // deterministic, lowercase alnum

    // EMG-1: found the region ONCE; ALWAYS migrate the current cohort into it, so a
    // later wave immigrates rather than being silently stranded.
    if (!getRegion(env.getState(), newId)) {
      const institutions =
        profile === "strict"
          ? makeInstitutions({
              verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: true },
              diplomacyPolicy: { defaultStance: "reexamine", overrides: {} },
            })
          : makeInstitutions({
              verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false },
              diplomacyPolicy: { defaultStance: "absorb", overrides: {} },
            });

      const def = defineRegion(newId, `${profile} secession from ${sourceRegion}`, institutions);
      proposeFounding(
        env,
        emergenceProposal(def, sourceRegion, `institutional mismatch: ${profile} cohort`, cohort.map((a) => a.id)),
      );
      admitTreasury(env, newId);
    }
    for (const a of cohort) immigrate(env, a.id, newId);
  }
}
