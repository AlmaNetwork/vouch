// Foundations A + B interplay — the event-sourced world skeleton (§M1).
//
// The design promise (§M1 design promise): there is NO API to set world state
// directly. State changes ONLY through `emit(event)`, which appends to the log
// and folds the event through the reducer. Therefore state is always
// reconstructable from the log alone — see `replayState`.

import { type AlmaEvent, EVENT_TICK, SYSTEM_ACTOR } from "./event";
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
  /** Author a PRINCIPAL event (a non-system actor). SYSTEM_ACTOR is rejected here — use commitSystem. */
  emit(type: string, actor: string, payload?: Record<string, unknown>): AlmaEvent;
  /**
   * Author an ENVIRONMENT event (actor = SYSTEM_ACTOR). The privileged §2-4 commit:
   * only code that holds a CommitSink (the env-only write capability) can produce a
   * system-authored / conserved event. Keep CommitSink out of untrusted hands.
   */
  commitSystem(type: string, payload?: Record<string, unknown>): AlmaEvent;
}

/**
 * A READ-ONLY view of a world (audit G11): readers only, no mutators. The §5
 * observation layer takes ONLY this, so "watching can never change the world"
 * (§2-6) is a compile-time fact, not a discipline. `World` structurally satisfies it.
 */
export interface WorldView<S> {
  getState(): S;
  readonly tick: number;
  readonly log: WorldLog;
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

export class World<S> implements CommitSink<S>, WorldView<S> {
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

  /** Append an event + fold it into state — the single internal mutation. */
  private author(type: string, actor: string, payload: Record<string, unknown>): AlmaEvent {
    const event = this.events.append({ tick: this.currentTick, type, actor, payload });
    this.currentState = deepFreeze(this.reducer(this.currentState, event));
    return event;
  }

  /**
   * Author an event as a PRINCIPAL (an agent / owner — a non-system actor).
   * §2-4 conservation (audit G4/G7): SYSTEM_ACTOR is REJECTED here, so a caller that
   * only reaches `emit` (e.g. a future network command handler) can never forge a
   * `world`-authored settlement. System events go through `commitSystem`, which is
   * only on the env-only CommitSink. The reducer ALSO gates on actor === SYSTEM_ACTOR,
   * so a forged non-system event is ignored on replay too (defence in depth).
   */
  emit(type: string, actor: string, payload: Record<string, unknown> = {}): AlmaEvent {
    if (actor === SYSTEM_ACTOR) {
      throw new Error(`emit: actor "${SYSTEM_ACTOR}" is reserved for environment-authored events — use commitSystem`);
    }
    return this.author(type, actor, payload);
  }

  /**
   * Author an ENVIRONMENT event (actor = SYSTEM_ACTOR) — the privileged §2-4 commit.
   * Reachable only via a CommitSink (the env-only write capability), so the
   * conservation monopoly is enforced at WRITE time, not just at the reducer.
   */
  commitSystem(type: string, payload: Record<string, unknown> = {}): AlmaEvent {
    return this.author(type, SYSTEM_ACTOR, payload);
  }

  /** Advance discrete time by one tick, recording the advance as a system event. */
  advanceTick(): AlmaEvent {
    this.currentTick += 1;
    return this.commitSystem(EVENT_TICK, { tick: this.currentTick });
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
