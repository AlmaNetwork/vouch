// Layer 5 Observation — the read-only HTTP "connection point" (hono).
//
// External clients CONNECT here to WATCH the deterministic world: state, regions,
// agents, the event log, and metrics. It is the §2-9 ① observer entry — read-only,
// so it can never interfere with the experiment (§2-6). It is handed ONLY a
// `WorldView` (no emit/run/advanceTick), so "watching cannot write" is enforced by
// the type, not by discipline.

import { Hono } from "hono";
import { getAgent, listAgents } from "../agent";
import type { WorldState } from "../environment";
import type { WorldView } from "../foundation";
import { getRegion, listRegions } from "../region";
import { metrics } from "./metrics";

/** Build a read-only observation HTTP app over a world view. GET-only by construction. */
export function createObservationApp(view: WorldView<WorldState>): Hono {
  const app = new Hono();

  app.get("/", (c) => c.json({ service: "vouch observation", endpoints: ["/health", "/tick", "/metrics", "/state", "/regions", "/regions/:id", "/agents", "/agents/:id", "/log?since=N", "/log/digest"] }));
  app.get("/health", (c) => c.json({ ok: true, tick: view.tick }));
  app.get("/tick", (c) => c.json({ tick: view.tick }));
  app.get("/metrics", (c) => c.json(metrics(view)));

  app.get("/state", (c) => c.json(view.getState()));
  app.get("/regions", (c) => c.json(listRegions(view.getState())));
  app.get("/regions/:id", (c) => {
    const r = getRegion(view.getState(), c.req.param("id"));
    return r ? c.json(r) : c.json({ error: "region not found" }, 404);
  });
  app.get("/agents", (c) => c.json(listAgents(view.getState())));
  app.get("/agents/:id", (c) => {
    const a = getAgent(view.getState(), c.req.param("id"));
    return a ? c.json(a) : c.json({ error: "agent not found" }, 404);
  });

  app.get("/log", (c) => c.json(view.log.since(Number(c.req.query("since") ?? 0))));
  app.get("/log/digest", (c) => c.json({ digest: view.log.digest(), length: view.log.length }));

  return app;
}

export interface ObservationServer {
  readonly port: number;
  stop(): void;
}

/** Start the observation server on a port (Bun). The view stays read-only. */
export function serveObservation(view: WorldView<WorldState>, opts: { port?: number } = {}): ObservationServer {
  const port = opts.port ?? 8787;
  const server = Bun.serve({ port, fetch: createObservationApp(view).fetch });
  return { port, stop: () => server.stop() };
}
