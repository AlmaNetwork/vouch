// Layer 5 Observation — the read-only HTTP "connection point" (hono).
//
// External clients CONNECT here to WATCH the deterministic world: state, regions,
// agents, the event log, and metrics. It is the §2-9 ① observer entry — read-only,
// so it can never interfere with the experiment (§2-6). It is handed ONLY a
// `WorldView` (no emit/run/advanceTick), so "watching cannot write" is enforced by
// the type, not by discipline.

import { Hono } from "hono";
import { getAgent, listAgents } from "../agent";
import { getDefinition, listDefinitions } from "../definition";
import type { WorldState } from "../environment";
import type { WorldView } from "../foundation";
import { getItem, listItems } from "../item";
import { getRegion, listRegions } from "../region";
import { type Metrics, metrics } from "./metrics";

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

/**
 * `Cache-Control` for a derived read. One second is short enough that the world
 * still looks live and long enough that a CDN absorbs a burst: these endpoints are
 * unauthenticated and serialize on a single thread, so without it one client in a
 * loop is indistinguishable from a flood.
 */
const DERIVED_CACHE = "public, max-age=1";

/**
 * `Cache-Control` for the liveness and integrity reads.
 *
 * NOT cached, deliberately, even though `/log/digest` is the more expensive of the
 * two. A cached digest would break the thing it exists for: the deploy check writes,
 * then re-reads the digest and expects it to have moved (deploy/smoke.sh), and a
 * one-second-old answer turns a successful write into a failed deploy. The cost is
 * handled at the source instead — `EventLog.digest()` memoizes on length — rather
 * than by serving a stale answer.
 */
const LIVE_NO_CACHE = "no-store";

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

  /**
   * `metrics()` memoized on log length.
   *
   * It remains the most expensive read: it walks the whole event log and rebuilds
   * every per-region aggregate. That is linear now rather than quadratic (see
   * metrics.ts), but linear in the size of an append-only world still means an
   * unauthenticated GET whose cost never stops growing — and on a single thread it is
   * time every other request waits, including the health check the supervisor restarts
   * us on. Reads outnumber writes by design here (600/min against 10/min), so almost
   * all of them land on an unchanged world and cost nothing.
   *
   * Length is an exact key, not an approximation: every part of a world is derived by
   * folding its log, so nothing can differ between two calls at the same length. Tick
   * is not part of the key because `advanceTick` commits an EVENT_TICK, so it cannot
   * move without the length moving — the test in observation/read-cost.test.ts pins
   * that, and will fail loudly if a future tick path stops emitting.
   */
  let cached: { length: number; value: Metrics } | null = null;
  const memoizedMetrics = (): Metrics => {
    const length = view.log.length;
    if (cached?.length === length) return cached.value;
    const value = metrics(view);
    cached = { length, value };
    return value;
  };

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
        "/items",
        "/items/:id",
        "/definitions",
        "/definitions/:id",
        "/log?since=N",
        "/log/digest",
      ],
    }),
  );
  // `build` identifies WHICH code is answering. Without it a deploy and a failed
  // rollback look identical from the outside. `log.length` is here because the journal
  // has an operational ceiling — boot replays it in full, so its length is what governs
  // how long a restart takes — and nothing else on the surface reports it cheaply.
  app.get("/health", (c) =>
    c.json({ ok: true, tick: view.tick, build, log: { length: view.log.length } }, 200, { "cache-control": LIVE_NO_CACHE }),
  );
  app.get("/tick", (c) => c.json({ tick: view.tick }, 200, { "cache-control": LIVE_NO_CACHE }));
  app.get("/metrics", (c) => c.json(memoizedMetrics(), 200, { "cache-control": DERIVED_CACHE }));

  app.get("/state", (c) => c.json(view.getState(), 200, { "cache-control": DERIVED_CACHE }));
  app.get("/regions", (c) => c.json(listRegions(view.getState()), 200, { "cache-control": DERIVED_CACHE }));
  app.get("/regions/:id", (c) => {
    const r = getRegion(view.getState(), c.req.param("id"));
    return r ? c.json(r, 200, { "cache-control": DERIVED_CACHE }) : c.json({ error: "region not found" }, 404);
  });
  app.get("/agents", (c) => c.json(listAgents(view.getState()), 200, { "cache-control": DERIVED_CACHE }));
  app.get("/agents/:id", (c) => {
    const a = getAgent(view.getState(), c.req.param("id"));
    return a ? c.json(a, 200, { "cache-control": DERIVED_CACHE }) : c.json({ error: "agent not found" }, 404);
  });

  // The item ledger. Readable in `/state` too, but a caller who wants to know who holds
  // what should not have to fetch every region and agent to find out — the same reason
  // /regions and /agents exist as their own views.
  app.get("/items", (c) => c.json(listItems(view.getState()), 200, { "cache-control": DERIVED_CACHE }));
  app.get("/items/:id", (c) => {
    const i = getItem(view.getState(), c.req.param("id"));
    return i ? c.json(i, 200, { "cache-control": DERIVED_CACHE }) : c.json({ error: "item not found" }, 404);
  });

  // The RFC 0007 §4 definition store. These are readable in `/state` too, but a caller
  // who wants to know WHICH COMMANDS EXIST should not have to fetch the whole world to
  // find out — `/state` carries every region and agent with it, and is the largest
  // response on this surface by a wide margin.
  app.get("/definitions", (c) => c.json(listDefinitions(view.getState()), 200, { "cache-control": DERIVED_CACHE }));
  app.get("/definitions/:id", (c) => {
    const d = getDefinition(view.getState(), c.req.param("id"));
    return d ? c.json(d, 200, { "cache-control": DERIVED_CACHE }) : c.json({ error: "definition not found" }, 404);
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
    return c.json(view.log.since(since).slice(0, LOG_PAGE_LIMIT), 200, { "cache-control": DERIVED_CACHE });
  });
  app.get("/log/digest", (c) => c.json({ digest: view.log.digest(), length: view.log.length }, 200, { "cache-control": LIVE_NO_CACHE }));

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
