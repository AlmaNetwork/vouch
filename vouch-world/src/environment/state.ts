// Layer 4 Environment (engine) — the composition root + single write path.
//
// Hoisted out of region/ (audit G2): world-state OWNERSHIP belongs to the
// environment (layer 4), not to a single domain (region, layer 2). The root
// reducer composes per-layer SLICE reducers, so adding the M3 agent/economy
// slices is a same-layer edit HERE — never an upward import into region.
//
// §2-4 conservation invariant (audit G4 — to honor when the M3 economy lands in
// this layer): value/balance events must be produced ONLY by this layer's future
// executeTransfer, and the economy reducer must derive balances solely by folding
// env-authored settlement events — never trusting a raw, self-asserted balance
// event (World.emit is public, so the REDUCER fold point is the real chokepoint).

import { type AgentSlice, agentReducer } from "../agent";
import { type Reducer, World } from "../foundation";
import { type DecisionSlice, type RegionSlice, decisionReducer, regionReducer } from "../region";

export interface WorldState extends RegionSlice, AgentSlice, DecisionSlice {
  // M3 added the agent slice; balances/economy live inside agent state.
  // T1 added the decision slice (governance acts in flight / resolved).
}

export const INITIAL_WORLD_STATE: WorldState = { regions: {}, agents: {}, decisions: {} };

/**
 * Composes the per-layer slice reducers. Adding a slice is a downward edit in this
 * composition root, never an upward edit into region/agent. Each slice reducer
 * returns the SAME reference for events it ignores, so unrelated events don't churn.
 */
export const rootReducer: Reducer<WorldState> = (state, event) => {
  const regions = regionReducer({ regions: state.regions }, event).regions;
  const agents = agentReducer({ agents: state.agents }, event).agents;
  const decisions = decisionReducer({ decisions: state.decisions }, event).decisions;
  if (regions === state.regions && agents === state.agents && decisions === state.decisions) return state;
  return { regions, agents, decisions };
};

/** Construct an ALMA world: deterministic engine (M1) + the composed root reducer. */
export function createAlmaWorld(seed: string | number): World<WorldState> {
  return new World<WorldState>({ seed, initialState: INITIAL_WORLD_STATE, reducer: rootReducer });
}
