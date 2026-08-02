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
import { Hono } from "hono";
import { createObservationApp } from "vouch-world/observation";
import type { RegisterRequest, SignedRequest } from "./accounts";
import { type Logger, silentLogger } from "./log";
import type { VouchNode } from "./node";

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

export interface NodeAppOptions {
  /** Git tag / short SHA of the running code, surfaced at `GET /health`. */
  readonly build?: string;
  /** Structured logger. Defaults to silent so embedders and tests stay quiet. */
  readonly log?: Logger;
}

export function createNodeApp(node: VouchNode, opts: NodeAppOptions = {}): Hono {
  const log = opts.log ?? silentLogger;
  const app = new Hono();

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
    const body = await readBody(c.req.raw);
    if (body === null) return c.json(errorBody("bad-json", requestId), 400, header);
    const res = node.register(body as RegisterRequest);
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
    const body = await readBody(c.req.raw);
    if (body === null) return c.json(errorBody("bad-json", requestId), 400, header);
    const res = node.submit(body as SignedRequest);
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
  const observation = createObservationApp(node.world, { build: opts.build });
  app.all("*", (c) => observation.fetch(c.req.raw));
  return app;
}
