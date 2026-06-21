// Foundations A/B — deterministic execution + event log.
//
// The basement the rest of the world stands on: an append-only event log (the
// single source of truth), a deterministic RNG, a tick loop, and replay.

export { SYSTEM_ACTOR, EVENT_TICK, type AlmaEvent } from "./event";
export { EventLog, type WorldLog } from "./event-log";
export { Rng } from "./rng";
export { World, replayState, type Reducer, type TickContext, type WorldOptions, type CommitSink } from "./world";
export { deepFreeze, stableStringify, fnv1a } from "./util";
