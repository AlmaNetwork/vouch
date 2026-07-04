// Foundations A/B — deterministic execution + event log.
//
// The basement the rest of the world stands on: an append-only event log (the
// single source of truth), a deterministic RNG, a tick loop, and replay.

export { type AlmaEvent, EVENT_TICK, SYSTEM_ACTOR } from "./event";
export { EventLog, type WorldLog } from "./event-log";
export type { Result } from "./result";
export { Rng } from "./rng";
export { deepFreeze, fnv1a, stableStringify, tickToIso } from "./util";
export { type CommitSink, type Reducer, replayState, type TickContext, World, type WorldOptions, type WorldView } from "./world";
