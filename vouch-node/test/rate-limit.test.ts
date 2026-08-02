// Rate limiting: the buckets themselves, and the HTTP surface they sit on.

import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { MemoryAccountLog } from "../src/account-log";
import { createNodeApp, type NodeAppOptions } from "../src/http";
import { MemoryJournal } from "../src/journal";
import { VouchNode } from "../src/node";
import { perHour, perMinute, TokenBuckets } from "../src/rate-limit";
import { keypair, signCommand, signRegister } from "./helpers";

/** A clock the test drives by hand, so nothing here has to sleep. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (seconds: number) => (t += seconds * 1000) };
}

describe("TokenBuckets", () => {
  test("allows a full burst, then refuses", () => {
    const b = new TokenBuckets(perMinute(3), 100, clock().now);
    expect(b.take("k")).toBe(true);
    expect(b.take("k")).toBe(true);
    expect(b.take("k")).toBe(true);
    expect(b.take("k")).toBe(false);
  });

  test("keys are independent", () => {
    const b = new TokenBuckets(perMinute(1), 100, clock().now);
    expect(b.take("a")).toBe(true);
    expect(b.take("a")).toBe(false);
    expect(b.take("b")).toBe(true);
  });

  test("refills over time", () => {
    const c = clock();
    const b = new TokenBuckets(perMinute(60), 100, c.now); // one per second
    for (let i = 0; i < 60; i++) expect(b.take("k")).toBe(true);
    expect(b.take("k")).toBe(false);

    c.advance(1);
    expect(b.take("k")).toBe(true);
    expect(b.take("k")).toBe(false);
  });

  test("refill is capped at capacity — waiting does not bank credit", () => {
    const c = clock();
    const b = new TokenBuckets(perMinute(5), 100, c.now);
    c.advance(3600);
    for (let i = 0; i < 5; i++) expect(b.take("k")).toBe(true);
    expect(b.take("k")).toBe(false);
  });

  test("peek does not spend", () => {
    const b = new TokenBuckets(perMinute(1), 100, clock().now);
    expect(b.peek("k")).toBe(true);
    expect(b.peek("k")).toBe(true);
    expect(b.take("k")).toBe(true);
    expect(b.peek("k")).toBe(false);
  });

  test("retryAfter reports when the next token lands", () => {
    const c = clock();
    const b = new TokenBuckets(perMinute(60), 100, c.now); // one per second
    expect(b.retryAfter("k")).toBe(0);
    for (let i = 0; i < 60; i++) b.take("k");
    expect(b.retryAfter("k")).toBe(1);
  });

  test("capacity 0 disables the limit entirely", () => {
    const b = new TokenBuckets(perMinute(0), 100, clock().now);
    expect(b.enabled).toBe(false);
    for (let i = 0; i < 1000; i++) expect(b.take("k")).toBe(true);
    expect(b.size).toBe(0); // nothing is even tracked
  });

  // The keys are attacker-chosen, so "remember every caller" is a memory leak with a
  // stranger's hand on the tap.
  test("the map stays bounded under a flood of distinct keys", () => {
    const b = new TokenBuckets(perHour(60), 50, clock().now);
    for (let i = 0; i < 5000; i++) b.take(`ip-${i}`);
    expect(b.size).toBeLessThanOrEqual(50);
  });

  test("eviction prefers full buckets, which forgets nothing", () => {
    const c = clock();
    const b = new TokenBuckets(perMinute(60), 10, c.now);
    b.take("spender"); // 59 left
    for (let i = 0; i < 9; i++) b.take(`other-${i}`);

    // A minute later every other bucket has refilled to full, so they are
    // indistinguishable from absent and are the ones dropped.
    c.advance(60);
    b.take("newcomer");
    expect(b.size).toBeLessThanOrEqual(10);
  });
});

// --- the HTTP surface ------------------------------------------------------

const ALICE = keypair(1);
const IP_HEADER = "x-test-ip";

function makeApp(opts: Partial<NodeAppOptions> = {}): Hono {
  const node = new VouchNode({ seed: "r", notary: keypair(7), journal: new MemoryJournal(), accountLog: new MemoryAccountLog() });
  return createNodeApp(node, { clientIpHeader: IP_HEADER, ...opts });
}

const post = (app: Hono, path: string, body: unknown, ip = "1.1.1.1") =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", [IP_HEADER]: ip }, body: JSON.stringify(body) });

const get = (app: Hono, path: string, ip = "1.1.1.1") => app.request(path, { headers: { [IP_HEADER]: ip } });

describe("HTTP rate limiting", () => {
  test("reads are limited per IP, with Retry-After", async () => {
    const app = makeApp({ readsPerMinutePerIp: 3 });
    for (let i = 0; i < 3; i++) expect((await get(app, "/health")).status).toBe(200);

    const res = await get(app, "/health");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("rate-limited");
  });

  test("one IP's reads do not affect another's", async () => {
    const app = makeApp({ readsPerMinutePerIp: 2 });
    for (let i = 0; i < 2; i++) await get(app, "/health", "1.1.1.1");
    expect((await get(app, "/health", "1.1.1.1")).status).toBe(429);
    expect((await get(app, "/health", "2.2.2.2")).status).toBe(200);
  });

  test("writes are limited per IP before the body is even read", async () => {
    const app = makeApp({ writesPerHourPerIp: 2 });
    await post(app, "/v1/register", signRegister("acct:a", 0, keypair(1)));
    await post(app, "/v1/register", signRegister("acct:b", 0, keypair(2)));

    // Third attempt: malformed on purpose. It is still refused with 429, not 400,
    // which is what "before the body is read" means.
    const res = await app.request("/v1/register", {
      method: "POST",
      headers: { "content-type": "application/json", [IP_HEADER]: "1.1.1.1" },
      body: "not json",
    });
    expect(res.status).toBe(429);
  });

  test("limits recover as the clock advances", async () => {
    const c = clock();
    const app = makeApp({ readsPerMinutePerIp: 60, now: c.now });
    for (let i = 0; i < 60; i++) await get(app, "/health");
    expect((await get(app, "/health")).status).toBe(429);

    c.advance(1);
    expect((await get(app, "/health")).status).toBe(200);
  });

  test("the per-principal write limit applies to a real participant", async () => {
    const app = makeApp({ writesPerMinutePerPrincipal: 2, writesPerHourPerIp: 0 });
    expect((await post(app, "/v1/register", signRegister("acct:alice", 0, ALICE))).status).toBe(200);

    const found = (n: number, region: string) => signCommand("acct:alice", n, { kind: "found", regionId: region, displayName: "R" }, ALICE);
    expect((await post(app, "/v1/command", found(1, "one"))).status).toBe(200);
    expect((await post(app, "/v1/command", found(2, "two"))).status).toBe(200);
    expect((await post(app, "/v1/command", found(3, "three"))).status).toBe(429);
  });

  // The decision this test exists for: the principal in a request body is CLAIMED, not
  // proven, at the moment the bucket is consulted. If a claim alone could spend a
  // token, anyone could lock a participant out of their own account just by spamming
  // their name — a limiter that hands strangers a denial-of-service against real users.
  test("an unauthenticated caller cannot drain someone else's allowance", async () => {
    const app = makeApp({ writesPerMinutePerPrincipal: 2, writesPerHourPerIp: 0 });
    expect((await post(app, "/v1/register", signRegister("acct:alice", 0, ALICE))).status).toBe(200);

    // A stranger, signing with the wrong key, floods alice's name.
    const attacker = keypair(99);
    for (let i = 0; i < 50; i++) {
      const res = await post(
        app,
        "/v1/command",
        signCommand("acct:alice", 100 + i, { kind: "found", regionId: "x", displayName: "X" }, attacker),
      );
      expect(res.status).toBe(401); // rejected as a bad signature — never 429
    }

    // Alice still has her full allowance.
    const found = (n: number, region: string) => signCommand("acct:alice", n, { kind: "found", regionId: region, displayName: "R" }, ALICE);
    expect((await post(app, "/v1/command", found(1, "one"))).status).toBe(200);
    expect((await post(app, "/v1/command", found(2, "two"))).status).toBe(200);
  });

  // A rejected-by-the-engine write still consumed a nonce and still appended, so it
  // cost the node real work and has to cost the caller a token.
  test("an authenticated write the engine refuses still costs a token", async () => {
    const app = makeApp({ writesPerMinutePerPrincipal: 2, writesPerHourPerIp: 0 });
    expect((await post(app, "/v1/register", signRegister("acct:alice", 0, ALICE))).status).toBe(200);

    // "admit into a region alice does not own" — authenticated, then refused at 422.
    const bad = (n: number) =>
      signCommand("acct:alice", n, { kind: "admit", agentId: "x@ghost", region: "ghost", role: "merchant" }, ALICE);
    expect((await post(app, "/v1/command", bad(1))).status).toBe(422);
    expect((await post(app, "/v1/command", bad(2))).status).toBe(422);
    expect((await post(app, "/v1/command", bad(3))).status).toBe(429);
  });

  test("limits can be turned off entirely", async () => {
    const app = makeApp({ readsPerMinutePerIp: 0, writesPerHourPerIp: 0, writesPerMinutePerPrincipal: 0 });
    for (let i = 0; i < 200; i++) expect((await get(app, "/health")).status).toBe(200);
  });
});
