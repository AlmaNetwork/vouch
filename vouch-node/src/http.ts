// The node's HTTP surface: the engine's read-only observation app for GETs, plus
// two authenticated write routes. Reads and writes are cleanly split — the read
// app is handed only a WorldView (it structurally cannot emit), and every write
// goes through the node's verify -> apply -> persist path.

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

export function createNodeApp(node: VouchNode): Hono {
  const app = new Hono();

  // WRITE — authenticated, persisted.
  app.post("/v1/register", async (c) => {
    const body = await readBody(c.req.raw);
    if (body === null) return c.json({ ok: false, reason: "bad-json" }, 400);
    const res = node.register(body as RegisterRequest);
    return res.ok ? c.json({ ok: true, principal: res.principal }, 200) : c.json({ ok: false, reason: res.reason }, res.status);
  });

  app.post("/v1/command", async (c) => {
    const body = await readBody(c.req.raw);
    if (body === null) return c.json({ ok: false, reason: "bad-json" }, 400);
    const res = node.submit(body as SignedRequest);
    return res.ok
      ? c.json({ ok: true, detail: res.detail, events: res.events }, 200)
      : c.json({ ok: false, reason: res.reason }, res.status);
  });

  // READ — delegate everything else to the engine's read-only observation surface
  // (GET /state /regions /agents /metrics /log …). Delegating via `.fetch` keeps the
  // two packages' hono types decoupled and preserves the "reads can't write" boundary
  // (the observation app only ever receives a WorldView).
  const observation = createObservationApp(node.world);
  app.all("*", (c) => observation.fetch(c.req.raw));
  return app;
}
