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
import { type AlmaEvent, type Reducer, World } from "../foundation";
import { type ItemSlice, itemReducer } from "../item";
import { type RegionSlice, regionReducer } from "../region";

export interface WorldState extends RegionSlice, AgentSlice, ItemSlice {
  // M3 added the agent slice; balances/economy live inside agent state. P3 added the item slice.
}

export const INITIAL_WORLD_STATE: WorldState = { regions: {}, agents: {}, items: {} };

/**
 * Composes the per-layer slice reducers. Adding a slice is a downward edit in this
 * composition root, never an upward edit into region/agent. Each slice reducer
 * returns the SAME reference for events it ignores, so unrelated events don't churn.
 */
export const rootReducer: Reducer<WorldState> = (state, event) => {
  const regions = regionReducer({ regions: state.regions }, event).regions;
  const agents = agentReducer({ agents: state.agents }, event).agents;
  const items = itemReducer({ items: state.items }, event).items;
  if (regions === state.regions && agents === state.agents && items === state.items) return state;
  return { regions, agents, items };
};

/** Construct an ALMA world: deterministic engine (M1) + the composed root reducer. */
export function createAlmaWorld(seed: string | number): World<WorldState> {
  return new World<WorldState>({ seed, initialState: INITIAL_WORLD_STATE, reducer: rootReducer });
}

/**
 * Rebuild an ALMA world from a persisted event log — the replay-on-boot path a
 * durable node (Track B) uses to recover its full state after a restart. Same
 * composition root as `createAlmaWorld`; see `World.fromLog` for the guarantees.
 */
export function rehydrateAlmaWorld(seed: string | number, events: readonly AlmaEvent[]): World<WorldState> {
  return World.fromLog<WorldState>({ seed, initialState: INITIAL_WORLD_STATE, reducer: rootReducer }, events);
}
