// Track C — the WRITE side, as a STUB (task C8). There is no write HTTP API on this build;
// the real one is Track B's (createParticipateApp, command envelope, single-writer commit).
// This placeholder exists so the deploy skeleton, graceful shutdown, and the C11 integration
// test have an end-to-end write surface to talk to NOW. Every /v1 route returns 501 and
// echoes the request body, so a test can assert the envelope round-trips without asserting
// any real semantics. Replace this whole module with Track B's app when its contract lands.
//
// Framework-free (raw Bun.serve) on purpose — no hono here, so swapping in Track B's hono
// app is a clean replacement, and the stub adds zero dependencies.

import type { NodeConfig } from "./config";
import type { ServerHandle } from "./read-server";

/** The speculative /v1 routes — kept in lockstep with openapi/write.draft.yaml (task C10). */
export const V1_ROUTES = ["/v1/found", "/v1/amend", "/v1/admit", "/v1/transact", "/v1/migrate"] as const;

const PENDING = "pending Track B — the write surface is not implemented on this build";

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
        // For transact, name the receipt schema the real route WILL mint (alma.tx/receipt/v1),
        // so an integration test can assert the contract surface without real semantics.
        const expected = url.pathname === "/v1/transact" ? { receiptSchemaId: "alma.tx/receipt/v1" } : undefined;
        return Response.json(
          { error: "not-implemented", detail: PENDING, path: url.pathname, received, expected },
          { status: 501 },
        );
      }

      return Response.json({ error: "not-found", path: url.pathname }, { status: 404 });
    },
  });
  return { port: config.writePort, stop: () => server.stop() };
}
