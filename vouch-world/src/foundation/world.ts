// Foundations A + B interplay — the event-sourced world skeleton (§M1).
//
// The design promise (§M1 design promise): there is NO API to set world state
// directly. State changes ONLY through `emit(event)`, which appends to the log
// and folds the event through the reducer. Therefore state is always
// reconstructable from the log alone — see `replayState`.

import { EVENT_TICK, SYSTEM_ACTOR, type AlmaEvent } from "./event";
import { EventLog, type WorldLog } from "./event-log";
import { Rng } from "./rng";
import { deepFreeze } from "./util";

export type Reducer<S> = (state: S, event: AlmaEvent) => S;

/**
 * The narrow write capability (audit G3): read current state + emit one event.
 * Pass THIS — not the whole World — to operations that only need to commit an
 * event (founding, the future economy executeTransfer), so callers never inherit
 * rng / advanceTick / run / log. `World` structurally satisfies it.
 */
export interface CommitSink<S> {
  getState(): S;
  emit(type: string, actor: string, payload?: Record<string, unknown>): AlmaEvent;
}

export interface TickContext<S> {
  readonly tick: number;
  readonly rng: Rng;
  readonly state: S;
  emit(type: string, actor: string, payload?: Record<string, unknown>): AlmaEvent;
}

export interface WorldOptions<S> {
  readonly seed: string | number;
  readonly initialState: S;
  readonly reducer: Reducer<S>;
}

export class World<S> implements CommitSink<S> {
  readonly rng: Rng;
  /** Read-only view of the log (audit G1) — no `append`; emit is the only writer. */
  readonly log: WorldLog;

  private readonly events = new EventLog();
  private readonly reducer: Reducer<S>;
  private currentTick = 0;
  private currentState: S;

  constructor(opts: WorldOptions<S>) {
    this.rng = Rng.create(opts.seed);
    this.reducer = opts.reducer;
    this.currentState = deepFreeze(opts.initialState);
    this.log = this.events.asReadOnly();
  }

  get tick(): number {
    return this.currentTick;
  }

  /** Live world state (frozen — it can only change via `emit`). */
  getState(): S {
    return this.currentState;
  }

  /**
   * The ONLY way the world changes: append an event, fold it into state.
   * §2-4 conservation (audit G4): when the M3 economy lands, value/balance events
   * must be produced ONLY by the environment's executeTransfer, and the economy
   * reducer must honor them only when env-authored — never a self-asserted balance
   * event. Because this method is public, the REDUCER is the real chokepoint.
   */
  emit(type: string, actor: string, payload: Record<string, unknown> = {}): AlmaEvent {
    const event = this.events.append({ tick: this.currentTick, type, actor, payload });
    this.currentState = deepFreeze(this.reducer(this.currentState, event));
    return event;
  }

  /** Advance discrete time by one tick, recording the advance as an event. */
  advanceTick(): AlmaEvent {
    this.currentTick += 1;
    return this.emit(EVENT_TICK, SYSTEM_ACTOR, { tick: this.currentTick });
  }

  /** tick-loop skeleton: advance `ticks` times; each tick records ≥1 event. */
  run(ticks: number, onTick?: (ctx: TickContext<S>) => void): void {
    const self = this;
    for (let i = 0; i < ticks; i++) {
      this.advanceTick();
      onTick?.({
        get tick() {
          return self.currentTick;
        },
        rng: self.rng,
        get state() {
          return self.currentState;
        },
        emit: (type, actor, payload) => self.emit(type, actor, payload),
      });
    }
  }
}

/**
 * Rebuild world state purely from an event log (§2-7 replay).
 * The result must equal a live world's `{ tick, state }` for the same log.
 */
export function replayState<S>(events: readonly AlmaEvent[], initialState: S, reducer: Reducer<S>): { tick: number; state: S } {
  let state = initialState;
  for (const event of events) state = reducer(state, event);
  const last = events.at(-1);
  return { tick: last ? last.tick : 0, state: deepFreeze(state) };
}
