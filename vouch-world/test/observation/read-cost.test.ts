// The read surface is unauthenticated, uncached and serialized on one thread, so a
// caller looping over the expensive endpoints starves everything else — including the
// health check the supervisor restarts on. These tests cover the two things that keep
// that in hand: the memoized derivations, and the cache headers.
//
// The risk with a cache is a STALE answer, so most of what is here is about
// invalidation being exact rather than approximate.

import { describe, expect, test } from "bun:test";
import { admitAgent, admitTreasury, createAlmaWorld, experimenterProposal, proposeFounding } from "../../src/environment";
import { EventLog } from "../../src/foundation";
import { createObservationApp } from "../../src/observation";
import { defineRegion } from "../../src/region";

type App = ReturnType<typeof createObservationApp>;

function novaWorld() {
  const w = createAlmaWorld("read-cost");
  proposeFounding(w, experimenterProposal(defineRegion("nova", "Nova"), "t", "acct:alice"));
  admitTreasury(w, "nova");
  return w;
}

describe("EventLog.digest is memoized on length", () => {
  test("repeated calls agree, and an append changes the answer", () => {
    const log = new EventLog();
    log.append({ type: "a", tick: 0, actor: "world", payload: {} });
    const first = log.digest();

    expect(log.digest()).toBe(first); // cached
    log.append({ type: "b", tick: 0, actor: "world", payload: {} });
    expect(log.digest()).not.toBe(first); // and invalidated by the append
  });

  test("the cached value equals the value a fresh log computes", () => {
    const warm = new EventLog();
    const cold = new EventLog();
    for (const log of [warm, cold]) {
      log.append({ type: "x", tick: 1, actor: "world", payload: { n: 1 } });
      log.append({ type: "y", tick: 2, actor: "alice@nova", payload: { n: 2 } });
    }
    warm.digest(); // warm the cache, then append to both and compare
    warm.append({ type: "z", tick: 3, actor: "world", payload: {} });
    cold.append({ type: "z", tick: 3, actor: "world", payload: {} });

    expect(warm.digest()).toBe(cold.digest());
  });
});

describe("GET /metrics is memoized on log length", () => {
  test("a write is reflected immediately — the cache is not time-based", async () => {
    const w = novaWorld();
    const app: App = createObservationApp(w);

    const before = (await (await app.request("/metrics")).json()) as { agents: { total: number } };
    admitAgent(w, { id: "ann@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: "" });
    const after = (await (await app.request("/metrics")).json()) as { agents: { total: number } };

    expect(after.agents.total).toBe(before.agents.total + 1);
  });

  test("repeated reads of an unchanged world agree", async () => {
    const app: App = createObservationApp(novaWorld());
    const a = await (await app.request("/metrics")).text();
    const b = await (await app.request("/metrics")).text();
    expect(a).toBe(b);
  });

  // The memoize key is log length alone. That is only complete because a tick cannot
  // move without emitting — `advanceTick` commits an EVENT_TICK. If a future tick path
  // stops emitting, this fails and the key has to grow to include the tick.
  test("advancing a tick grows the log, which is what makes length a complete key", () => {
    const w = novaWorld();
    const before = w.log.length;
    w.advanceTick();
    expect(w.log.length).toBeGreaterThan(before);
  });

  test("a tick is reflected in /metrics", async () => {
    const w = novaWorld();
    const app: App = createObservationApp(w);
    expect(((await (await app.request("/metrics")).json()) as { tick: number }).tick).toBe(0);

    w.advanceTick();
    expect(((await (await app.request("/metrics")).json()) as { tick: number }).tick).toBe(1);
  });
});

describe("cache headers", () => {
  test("derived reads are briefly cacheable", async () => {
    const app: App = createObservationApp(novaWorld());
    for (const path of ["/metrics", "/state", "/regions", "/agents", "/log"]) {
      expect((await app.request(path)).headers.get("cache-control")).toBe("public, max-age=1");
    }
  });

  // /log/digest is the one a deploy uses to prove a write landed: it reads the digest,
  // writes, and re-reads expecting a different answer. A cached response would turn a
  // successful write into a failed deploy, so its cost is paid down by memoizing the
  // digest itself rather than by serving a stale one.
  test("liveness and integrity reads are not cacheable", async () => {
    const app: App = createObservationApp(novaWorld());
    for (const path of ["/health", "/tick", "/log/digest"]) {
      expect((await app.request(path)).headers.get("cache-control")).toBe("no-store");
    }
  });
});

describe("GET /health", () => {
  test("reports the journal length, which is what governs restart time", async () => {
    const w = novaWorld();
    const app: App = createObservationApp(w);
    const body = (await (await app.request("/health")).json()) as { ok: boolean; log: { length: number } };

    expect(body.ok).toBe(true);
    expect(body.log.length).toBe(w.log.length);
    expect(body.log.length).toBeGreaterThan(0);
  });
});
