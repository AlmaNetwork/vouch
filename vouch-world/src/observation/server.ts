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

/**
 * Largest `/log` page. The log is unauthenticated and grows without bound, so an
 * uncapped dump is both a bandwidth amplifier and a stall — serialization is
 * synchronous and Bun is single-threaded, so a big response blocks every other
 * request, including the health check.
 */
export const LOG_PAGE_LIMIT = 1000;

/** A non-negative integer query param, or `undefined` if it is anything else. */
function parseSeq(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return 0;
  if (!/^\d+$/.test(raw)) return undefined; // rejects "abc", "-1", "2.7", "1e3", " 5"
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

export interface ObservationOptions {
  /**
   * Which code is serving — a git tag or short SHA, reported at `GET /health`.
   * Passed IN rather than read from the environment: build identity is deploy
   * metadata, and the engine reads no ambient input (the same reason `issuedAt` is
   * caller-supplied in vouch-core). The node resolves `VOUCH_BUILD` and hands it here.
   */
  readonly build?: string;
}

/** Build a read-only observation HTTP app over a world view. GET-only by construction. */
export function createObservationApp(view: WorldView<WorldState>, opts: ObservationOptions = {}): Hono {
  const build = opts.build ?? "dev";
  const app = new Hono();

  app.get("/", (c) =>
    c.json({
      service: "vouch observation",
      endpoints: [
        "/health",
        "/tick",
        "/metrics",
        "/state",
        "/regions",
        "/regions/:id",
        "/agents",
        "/agents/:id",
        "/log?since=N",
        "/log/digest",
      ],
    }),
  );
  // `build` identifies WHICH code is answering. Without it a deploy and a failed
  // rollback look identical from the outside.
  app.get("/health", (c) => c.json({ ok: true, tick: view.tick, build }));
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

  // Still a bare array (vouch-cli, vouch-web and openapi/read.yaml all consume it that
  // way), but `since` is now validated and the page is capped. Passing the raw query to
  // Number() let slice() read sloppy values in ways no caller means: Number("abc") is
  // NaN and slice(NaN) returns the WHOLE log — an unauthenticated full dump from a
  // typo — while "-1" slices from the end and "2.7" silently truncates.
  //
  // A caller that receives exactly LOG_PAGE_LIMIT events should ask again from
  // `since + LOG_PAGE_LIMIT`; /log/digest reports the total length.
  app.get("/log", (c) => {
    const since = parseSeq(c.req.query("since"));
    if (since === undefined) return c.json({ error: "since must be a non-negative integer" }, 400);
    return c.json(view.log.since(since).slice(0, LOG_PAGE_LIMIT));
  });
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
