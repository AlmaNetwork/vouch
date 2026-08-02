// The node's HTTP surface: the engine's read-only observation app for GETs, plus
// two authenticated write routes. Reads and writes are cleanly split — the read
// app is handed only a WorldView (it structurally cannot emit), and every write
// goes through the node's verify -> apply -> persist path.
//
// Every write response carries a request id (body + `x-request-id` header) for
// tracing, and failures use one uniform envelope: `{ ok: false, error: { code,
// message, requestId } }` — `code` is the machine-readable reason, `message` its
// human form.

import { randomUUID } from "node:crypto";
import { type Context, Hono } from "hono";
import { createObservationApp } from "vouch-world/observation";
import type { RegisterRequest, SignedRequest } from "./accounts";
import { type Logger, silentLogger } from "./log";
import type { VouchNode } from "./node";
import { perHour, perMinute, TokenBuckets } from "./rate-limit";

async function readBody(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** The uniform error envelope: a stable machine `code`, its human `message`, and the request id. */
function errorBody(code: string, requestId: string) {
  return { ok: false as const, error: { code, message: code.replace(/-/g, " "), requestId } };
}

/**
 * Longest client-IP header value we will use as a bucket key. The value is
 * caller-supplied, and an unbounded one becomes an unbounded map key.
 */
const MAX_IP_KEY_LENGTH = 64;

/** The principal a request CLAIMS to be, unverified — enough to look up a bucket. */
function claimedPrincipal(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const p = (body as { principal?: unknown }).principal;
  return typeof p === "string" && p.length > 0 && p.length <= 256 ? p : null;
}

export interface NodeAppOptions {
  /** Git tag / short SHA of the running code, surfaced at `GET /health`. */
  readonly build?: string;
  /** Structured logger. Defaults to silent so embedders and tests stay quiet. */
  readonly log?: Logger;
  /**
   * Header carrying the real client IP (lowercased). Null uses the socket address.
   * Only safe when the node is unreachable except through a proxy that overwrites it
   * — see NodeConfig.clientIpHeader.
   */
  readonly clientIpHeader?: string | null;
  /** Signed writes per minute per principal. 0 disables. Default 10. */
  readonly writesPerMinutePerPrincipal?: number;
  /** Write attempts per hour per client IP. 0 disables. Default 60. */
  readonly writesPerHourPerIp?: number;
  /** Reads per minute per client IP. 0 disables. Default 600. */
  readonly readsPerMinutePerIp?: number;
  /** Injectable clock, so tests can advance time without sleeping. */
  readonly now?: () => number;
}

export function createNodeApp(node: VouchNode, opts: NodeAppOptions = {}): Hono {
  const log = opts.log ?? silentLogger;
  const app = new Hono();
  const now = opts.now ?? Date.now;
  const ipHeader = opts.clientIpHeader ?? null;

  const writesPerPrincipal = new TokenBuckets(perMinute(opts.writesPerMinutePerPrincipal ?? 10), 10_000, now);
  const writesPerIp = new TokenBuckets(perHour(opts.writesPerHourPerIp ?? 60), 10_000, now);
  const readsPerIp = new TokenBuckets(perMinute(opts.readsPerMinutePerIp ?? 600), 10_000, now);

  /**
   * The caller's identity for rate limiting.
   *
   * Behind the shipped reverse proxy every socket address is 127.0.0.1, so without a
   * configured header the whole world shares one bucket. That is a LOUD failure and
   * deliberately so: the alternative — treating an unidentifiable caller as exempt —
   * fails silently, and a rate limiter that has quietly stopped limiting is worse than
   * one that is obviously too strict.
   */
  function clientIp(c: Context): string {
    if (ipHeader) {
      const raw = c.req.header(ipHeader);
      // Take the first entry: forwarding headers accumulate left-to-right, and the
      // proxy we trust writes the origin-most value at the front.
      const first = raw?.split(",")[0]?.trim();
      if (first && first.length <= MAX_IP_KEY_LENGTH) return first;
    }
    const env = c.env as { requestIP?: (r: Request) => { address: string } | null } | undefined;
    return env?.requestIP?.(c.req.raw)?.address ?? "unknown";
  }

  function tooMany(c: Context, buckets: TokenBuckets, key: string, requestId: string, scope: string) {
    const retry = Math.max(1, buckets.retryAfter(key));
    log.warn({ requestId, scope }, "rate limited");
    return c.json(errorBody("rate-limited", requestId), 429, {
      "x-request-id": requestId,
      "retry-after": String(retry),
    });
  }

  // Access log. Deliberately records the request id (which the client already has, so a
  // user-reported id is enough to find this line) and NOT the client IP or the request
  // body — a command body carries principals, amounts and a signature.
  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
        requestId: c.res.headers.get("x-request-id") ?? undefined,
      },
      "request",
    );
  });

  // WRITE — authenticated, persisted.
  app.post("/v1/register", async (c) => {
    const requestId = randomUUID();
    const header = { "x-request-id": requestId };
    // Per-IP first, before the body is even read: this is the limit that stands between
    // an unauthenticated stranger and the durable auth log, so it must not depend on
    // anything the stranger supplies.
    const ip = clientIp(c);
    if (!writesPerIp.take(ip)) return tooMany(c, writesPerIp, ip, requestId, "write-ip");

    const body = await readBody(c.req.raw);
    if (body === null) return c.json(errorBody("bad-json", requestId), 400, header);
    const res = node.register(body as RegisterRequest);
    // No per-principal bucket here on purpose: registration is first-writer-wins, so a
    // principal can only ever succeed once and a per-principal limit would add nothing.
    // The principal is logged; it is a public identifier, and without it a rejected
    // write cannot be traced to an account.
    log.info({ requestId, principal: res.ok ? res.principal : undefined, ok: res.ok }, "register");
    return res.ok
      ? c.json({ ok: true, principal: res.principal, requestId }, 200, header)
      : c.json(errorBody(res.reason, requestId), res.status, header);
  });

  app.post("/v1/command", async (c) => {
    const requestId = randomUUID();
    const header = { "x-request-id": requestId };
    const ip = clientIp(c);
    if (!writesPerIp.take(ip)) return tooMany(c, writesPerIp, ip, requestId, "write-ip");

    const body = await readBody(c.req.raw);
    if (body === null) return c.json(errorBody("bad-json", requestId), 400, header);

    // The principal here is CLAIMED, not proven — the signature has not been checked
    // yet. So peek, never spend: if a claim alone could drain a bucket, anyone could
    // lock a participant out of their own account by spamming their name. The IP bucket
    // above is what actually costs an unauthenticated caller anything.
    const claimed = claimedPrincipal(body);
    if (claimed !== null && !writesPerPrincipal.peek(claimed)) {
      return tooMany(c, writesPerPrincipal, claimed, requestId, "write-principal");
    }

    const res = node.submit(body as SignedRequest);

    // Charge only once the signature has verified. A 422 still charges: the nonce was
    // consumed and the append happened, so the write cost the node real work.
    if (claimed !== null && (res.ok || res.authenticated)) writesPerPrincipal.take(claimed);

    log.info({ requestId, ok: res.ok, events: res.ok ? res.events : 0, reason: res.ok ? undefined : res.reason }, "command");
    return res.ok
      ? c.json({ ok: true, detail: res.detail, events: res.events, requestId }, 200, header)
      : c.json(errorBody(res.reason, requestId), res.status, header);
  });

  // READ — a principal's account state: whether it is registered and its current
  // nonce. A client (CLI, GUI) reads this to allocate the next strictly-increasing
  // nonce for a signed command, so it never has to track nonces locally. The nonce is
  // a public sequence counter (not a secret), like an account transaction count.
  app.get("/v1/account/:principal", (c) => {
    const principal = c.req.param("principal");
    const nonce = node.nonceOf(principal);
    return c.json({ principal, registered: nonce !== null, nonce: nonce ?? -1 });
  });

  // READ — delegate everything else to the engine's read-only observation surface
  // (GET /state /regions /agents /metrics /log …). Delegating via `.fetch` keeps the
  // two packages' hono types decoupled and preserves the "reads can't write" boundary
  // (the observation app only ever receives a WorldView).
  //
  // Reads are limited too. They are unauthenticated, uncached, and serialized on a
  // single thread, so a caller looping over the expensive ones starves every other
  // request — including the health check the supervisor restarts us on.
  const observation = createObservationApp(node.world, { build: opts.build });
  app.all("*", (c) => {
    const ip = clientIp(c);
    if (!readsPerIp.take(ip)) return tooMany(c, readsPerIp, ip, randomUUID(), "read-ip");
    return observation.fetch(c.req.raw);
  });
  return app;
}
