// Layer 3 Agent — the brain: (read-only view) -> intent (audit G6).
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

/** Is there an open proposal in `region` this agent holds a binding, not-yet-cast vote on? */
function hasBindingVote(region: RegionState | undefined, agentId: string): boolean {
  const g = region?.institutions.governance;
  return Boolean(
    region?.openProposal && g?.kind === "council" && g.members.includes(agentId) && !region.openProposal.votes.includes(agentId),
  );
}

/**
 * A civic-minded agent: when a council it SITS ON has an amendment on the table and
 * its voice is binding (a member who hasn't voted yet), back it; otherwise trade.
 * A seat is id-bound, not residency-bound, so the home region is checked first and
 * then every other region — an emigrated member keeps voting (naming the region in
 * the intent) instead of wedging the proposal. Deliberately NOT in defaultBrains —
 * governance participation is an opt-in regime variable, so seeded histories keep
 * their digests.
 */
export const voterBrain: Brain = (view) => {
  if (hasBindingVote(view.homeRegion, view.self.id)) return { kind: "vote" };
  for (const region of view.otherRegions) {
    if (hasBindingVote(region, view.self.id)) return { kind: "vote", regionId: region.id };
  }
  return tradingBrain(view);
};

export const defaultBrains: Partial<Record<AgentState["role"], Brain>> = {
  artisan: tradingBrain,
  merchant: tradingBrain,
  broker: tradingBrain,
};
