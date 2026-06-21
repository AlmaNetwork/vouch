// 第3層 Agent — the brain: (read-only view) -> intent (audit G6).
//
// A brain receives ONLY a frozen read-only view — no emit, no rng, no clock. It
// returns an Intent; the environment journals it (agent.decided) and executes it.
// Replay re-folds the journaled intent and NEVER re-invokes the brain, so the
// rule-based -> LLM swap stays deterministic (§2-7). Any stochasticity arrives as
// `view.roll`, a single deterministic draw the driver supplies — not a generator.

import type { RegionState } from "../region";
import type { AgentState, Intent } from "./types";

export interface ReadOnlyView {
  readonly tick: number;
  readonly self: AgentState;
  readonly peers: readonly AgentState[]; // same-region, non-treasury, others
  readonly homeRegion: RegionState | undefined;
  readonly otherRegions: readonly RegionState[];
  readonly roll: number; // deterministic draw in [0, 1)
}

export type Brain = (view: ReadOnlyView) => Intent;

/** Does nothing. */
export const idleBrain: Brain = () => ({ kind: "idle" });

/** A simple trader: if it holds enough currency and has a peer, send a fixed amount. */
export const tradingBrain: Brain = (view) => {
  if (view.self.balances.currency >= 10 && view.peers.length > 0) {
    const idx = Math.floor(view.roll * view.peers.length);
    const target = view.peers[idx];
    if (target) return { kind: "transfer", to: target.id, amount: 10 };
  }
  return { kind: "idle" };
};

export const defaultBrains: Partial<Record<AgentState["role"], Brain>> = {
  artisan: tradingBrain,
  merchant: tradingBrain,
  broker: tradingBrain,
};
