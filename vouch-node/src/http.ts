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

export function createNodeApp(node: VouchNode): Hono {
  const app = new Hono();

  // WRITE — authenticated, persisted.
  app.post("/v1/register", async (c) => {
    const requestId = randomUUID();
    const header = { "x-request-id": requestId };
    const body = await readBody(c.req.raw);
    if (body === null) return c.json(errorBody("bad-json", requestId), 400, header);
    const res = node.register(body as RegisterRequest);
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
  const observation = createObservationApp(node.world);
  app.all("*", (c) => observation.fetch(c.req.raw));
  return app;
}
