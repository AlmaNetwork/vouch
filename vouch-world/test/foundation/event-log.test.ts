import { describe, expect, test } from "bun:test";
import { EventLog } from "../../src/foundation/event-log";

describe("append-only event log", () => {
  test("append assigns monotonically increasing seq", () => {
    const log = new EventLog();
    const a = log.append({ tick: 1, type: "x", actor: "a@r", payload: {} });
    const b = log.append({ tick: 1, type: "y", actor: "b@r", payload: { n: 1 } });
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(log.length).toBe(2);
  });

  test("stored events are frozen (cannot be mutated)", () => {
    const log = new EventLog();
    const e = log.append({ tick: 0, type: "x", actor: "a@r", payload: { n: 1 } });
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.payload)).toBe(true);
    expect(() => {
      (e as { type: string }).type = "hacked";
    }).toThrow();
    expect(log.at(0)?.type).toBe("x");
  });

  test("all() returns a copy — callers cannot push into the source of truth", () => {
    const log = new EventLog();
    log.append({ tick: 0, type: "x", actor: "a@r", payload: {} });
    const snapshot = log.all();
    snapshot.push({ seq: 99, tick: 0, type: "evil", actor: "x@r", payload: {} });
    expect(log.length).toBe(1);
  });

  test("at / since address events by seq", () => {
    const log = new EventLog();
    for (let i = 0; i < 5; i++) log.append({ tick: i, type: "t", actor: "a@r", payload: { i } });
    expect(log.at(2)?.payload).toEqual({ i: 2 });
    expect(log.since(3).map((e) => e.seq)).toEqual([3, 4]);
  });

  test("digest matches for identical logs and differs otherwise", () => {
    const build = (lastType: string) => {
      const log = new EventLog();
      log.append({ tick: 0, type: "a", actor: "x@r", payload: { v: 1 } });
      log.append({ tick: 1, type: lastType, actor: "y@r", payload: { v: 2 } });
      return log;
    };
    expect(build("b").digest()).toBe(build("b").digest());
    expect(build("b").digest()).not.toBe(build("c").digest());
  });
});
