import { describe, expect, test } from "bun:test";
import { EVENT_TICK, SYSTEM_ACTOR, type AlmaEvent } from "../../src/foundation/event";
import { type Reducer, World, replayState } from "../../src/foundation/world";

// A tiny domain to exercise the event-sourcing machinery without pulling in any
// M2+ concept: count "ping" events and remember the last actor.
interface DemoState {
  readonly pings: number;
  readonly lastActor: string | null;
}
const INITIAL: DemoState = { pings: 0, lastActor: null };

const reducer: Reducer<DemoState> = (state, event) => {
  if (event.type === "ping") {
    return { pings: state.pings + 1, lastActor: event.actor };
  }
  return state;
};

// Deterministic per-tick step: randomness flows only through ctx.rng, and the
// only way to change state is ctx.emit.
const ACTORS = ["alice@umi", "bob@umi", "carol@yama"];
function step(ctx: { rng: import("../../src/foundation/rng").Rng; emit: (t: string, a: string, p?: Record<string, unknown>) => unknown }): void {
  if (ctx.rng.bool(0.6)) {
    ctx.emit("ping", ctx.rng.pick(ACTORS), { value: ctx.rng.nextUint32() });
  }
}

function makeWorld(seed: string) {
  return new World<DemoState>({ seed, initialState: INITIAL, reducer });
}

describe("world / tick loop", () => {
  test("each tick records at least one event and advances the clock", () => {
    const w = makeWorld("ticks");
    w.run(5);
    expect(w.tick).toBe(5);
    const tickEvents = w.log.all().filter((e) => e.type === EVENT_TICK);
    expect(tickEvents.length).toBe(5);
    expect(tickEvents.map((e) => e.payload.tick)).toEqual([1, 2, 3, 4, 5]);
  });

  test("same seed + same script => byte-identical history", () => {
    const a = makeWorld("run-1");
    const b = makeWorld("run-1");
    a.run(50, step);
    b.run(50, step);

    expect(a.log.all()).toEqual(b.log.all());
    expect(a.log.digest()).toBe(b.log.digest());
    expect(a.getState()).toEqual(b.getState());
    expect(a.tick).toBe(b.tick);
  });

  test("different seed => different history", () => {
    const a = makeWorld("seed-a");
    const b = makeWorld("seed-b");
    a.run(50, step);
    b.run(50, step);
    expect(a.log.digest()).not.toBe(b.log.digest());
  });

  test("state reconstructed from the log equals live state", () => {
    const w = makeWorld("replay");
    w.run(40, step);

    const rebuilt = replayState(w.log.all(), INITIAL, reducer);
    expect(rebuilt.state).toEqual(w.getState());
    expect(rebuilt.tick).toBe(w.tick);
  });

  test("there is no API to set state directly; live state is frozen", () => {
    const w = makeWorld("frozen");
    w.run(3, step);
    expect((w as unknown as { setState?: unknown }).setState).toBeUndefined();
    expect(Object.isFrozen(w.getState())).toBe(true);
    expect(() => {
      (w.getState() as { pings: number }).pings = 999;
    }).toThrow();
  });

  test("state only ever changes through emit (folded events)", () => {
    const w = makeWorld("emit");
    expect(w.getState()).toEqual(INITIAL);
    w.emit("ping", "alice@umi", { value: 1 });
    expect(w.getState()).toEqual({ pings: 1, lastActor: "alice@umi" });

    // Replaying just the emitted events reproduces the same state.
    const events: AlmaEvent[] = w.log.all();
    expect(replayState(events, INITIAL, reducer).state).toEqual(w.getState());
  });

  test("emit rejects SYSTEM_ACTOR; commitSystem is the only system-authoring path (§2-4)", () => {
    const w = makeWorld("cap");
    // a principal-authored event is fine
    w.emit("ping", "alice@umi", { value: 1 });
    expect(w.getState().lastActor).toBe("alice@umi");
    // forging a system-authored event via emit throws at WRITE time (can't enter the log)
    expect(() => w.emit("ping", SYSTEM_ACTOR, {})).toThrow();
    expect(w.getState().pings).toBe(1); // the forged emit did not append
    // the privileged commit authors with SYSTEM_ACTOR
    w.commitSystem("ping", { value: 2 });
    expect(w.getState().lastActor).toBe(SYSTEM_ACTOR);
  });

  test("world.log is read-only: no append, so emit is the only path into the log (G1)", () => {
    const w = makeWorld("locked");
    w.run(4, step);
    // The exposed log facade has every reader but NO append (reducer-bypass write).
    expect((w.log as unknown as { append?: unknown }).append).toBeUndefined();
    expect(typeof w.log.all).toBe("function");
    expect(typeof w.log.digest).toBe("function");
    // And the log still fully reconstructs live state.
    expect(replayState(w.log.all(), INITIAL, reducer).state).toEqual(w.getState());
  });
});
