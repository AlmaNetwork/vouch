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

import { type AgentEventMap, type AgentSlice, agentReducer } from "../agent";
import { type DefinitionEventMap, type DefinitionSlice, definitionReducer } from "../definition";
import { type AlmaEvent, type CommitSink, type Reducer, World, type WorldView } from "../foundation";
import { type ItemEventMap, type ItemSlice, itemReducer } from "../item";
import { type RegionEventMap, type RegionSlice, regionReducer } from "../region";

export interface WorldState extends RegionSlice, AgentSlice, ItemSlice, DefinitionSlice {
  // M3 added the agent slice; balances/economy live inside agent state. P3 added the item slice.
  // RFC 0007 §4 added the definition slice — data-defined commands stored in the log.
}

/** The env-only WRITE capability over a world (audit G3). Every environment mutator takes this. */
export type WorldCommit = CommitSink<WorldState>;
/** The read-only VIEW over a world (audit G11). The observation layer takes this. */
export type WorldViewOf = WorldView<WorldState>;

/**
 * Read an entity back after committing the event that creates/updates it. A missing
 * value here means the reducer didn't fold the just-emitted event — an internal
 * invariant break, not a user error — so we throw. Centralizes the read-back-or-throw
 * ritual every env write op shares.
 */
export function readBackOrThrow<T>(op: string, value: T | undefined): T {
  if (value === undefined) throw new Error(`${op}: invariant violated — entity missing after its event`);
  return value;
}

/** Every system event the environment authors, mapped to its payload — keys the typed `commit`. */
export type WorldEventMap = AgentEventMap & RegionEventMap & ItemEventMap & DefinitionEventMap;

/**
 * Author a system event, type-checked. The payload must match the event type's declared
 * shape (WorldEventMap), so a wrong-shaped or misspelled payload is a compile error at the
 * call site rather than an `as`-cast in the reducer. A thin wrapper over commitSystem.
 */
export function commit<K extends keyof WorldEventMap>(env: WorldCommit, type: K, payload: WorldEventMap[K]): AlmaEvent {
  return env.commitSystem(type, payload as Record<string, unknown>);
}

export const INITIAL_WORLD_STATE: WorldState = { regions: {}, agents: {}, items: {}, definitions: {} };

/**
 * Composes the per-layer slice reducers. Adding a slice is a downward edit in this
 * composition root, never an upward edit into region/agent. Each slice reducer
 * returns the SAME reference for events it ignores, so unrelated events don't churn.
 */
export const rootReducer: Reducer<WorldState> = (state, event) => {
  const regions = regionReducer({ regions: state.regions }, event).regions;
  const agents = agentReducer({ agents: state.agents }, event).agents;
  const items = itemReducer({ items: state.items }, event).items;
  const definitions = definitionReducer({ definitions: state.definitions }, event).definitions;
  if (regions === state.regions && agents === state.agents && items === state.items && definitions === state.definitions) return state;
  return { regions, agents, items, definitions };
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
