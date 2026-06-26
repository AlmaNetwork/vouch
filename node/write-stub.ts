// Track C — the WRITE side, as a STUB (task C8). The real write node is Track B's
// (PR #3 feat/impl-app: a command-driven Node/@hono/node-server app with /v1/execute +
// /v1/simulate + per-action routes, Bearer auth, Idempotency-Key, SQLite journal). Its
// contract is mirrored in openapi/write.draft.yaml. This placeholder exists so the deploy
// skeleton, graceful shutdown, and the C11 integration test have an end-to-end write surface
// to talk to NOW: every route returns 501 and echoes the request body, so a test can assert
// the route surface round-trips without real semantics. Swap this for Track B's app when wired.
//
// Framework-free (raw Bun.serve) on purpose — no hono here, so swapping in Track B's hono
// app is a clean replacement, and the stub adds zero dependencies.

import type { NodeConfig } from "./config";
import type { ServerHandle } from "./read-server";

/** Track B's POST write routes (mirrors openapi/write.draft.yaml — PR #3's command-driven node). */
export const V1_ROUTES = [
  "/v1/found",
  "/v1/execute", // the command bus
  "/v1/simulate", // dry-run
  "/v1/amend",
  "/v1/admit",
  "/v1/transact",
  "/v1/migrate",
] as const;

const PENDING = "pending Track B — the write node (PR #3 command-driven API) is not wired on this build";

/** Serve the write-node STUB. Returns a handle with stop() for graceful shutdown. */
export function serveWriteStub(config: NodeConfig): ServerHandle {
  const server = Bun.serve({
    port: config.writePort,
    fetch: async (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/" || url.pathname === "/health") {
        return Response.json({ service: "vouch write node (STUB)", ok: true, status: PENDING, routes: V1_ROUTES });
      }

      if ((V1_ROUTES as readonly string[]).includes(url.pathname)) {
        // Echo the posted envelope so an integration test can check the request shape
        // round-trips. 501 = recognized route, not yet implemented.
        let received: unknown = null;
        if (req.method === "POST") {
          try {
            received = await req.json();
          } catch {
            received = null;
          }
        }
        return Response.json(
          { error: "not-implemented", detail: PENDING, path: url.pathname, received },
          { status: 501 },
        );
      }

      return Response.json({ error: "not-found", path: url.pathname }, { status: 404 });
    },
  });
  return { port: config.writePort, stop: () => server.stop() };
}
