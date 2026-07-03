// Wires the whole thing into one hono app:
//   • RFC 9728 protected-resource-metadata (so clients discover the auth server)
//   • the bundled dev Authorization Server (unless an external IdP is configured)
//   • the bearer-protected MCP endpoint over Streamable HTTP
//
// The MCP endpoint keeps one transport per session, BOUND to the principal that
// initialized it. The bearer token is verified on every request, and a session may
// only be driven by the same principal that opened it (a session-hijack guard).

import { randomUUID } from "node:crypto";
import { StreamableHTTPTransport } from "@hono/mcp";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { createRemoteJWKSet } from "jose";
import { type AccountLog, FileAccountLog, FileJournal, type Journal, MemoryAccountLog, MemoryJournal, VouchNode } from "vouch-node";
import { createObservationApp } from "vouch-world/observation";
import { type AuditSink, MemoryAudit } from "./audit";
import type { McpConfig } from "./config";
import { Custody } from "./custody";
import { DevAuthServer } from "./dev-as";
import { buildMcpServer } from "./mcp";
import { makeVerifier, protectedResourceMetadata, type VerifyKey, wwwAuthenticate } from "./resource-server";

const SERVER_INFO = { name: "vouch-mcp", version: "0.0.0" } as const;

function rpcError(message: string): { jsonrpc: "2.0"; error: { code: number; message: string }; id: null } {
  return { jsonrpc: "2.0", error: { code: -32000, message }, id: null };
}

export interface McpApp {
  readonly app: Hono;
  readonly node: VouchNode;
  readonly custody: Custody;
  readonly audit: AuditSink;
  readonly devAs: DevAuthServer | null;
  readonly config: McpConfig;
}

/** Build the full vouch-mcp application. Async because it resolves the AS signing key up front. */
export async function createMcpApp(config: McpConfig): Promise<McpApp> {
  const journal: Journal = config.node.journalPath ? new FileJournal(config.node.journalPath) : new MemoryJournal();
  const accountLog: AccountLog = config.node.accountsPath ? new FileAccountLog(config.node.accountsPath) : new MemoryAccountLog();
  const node = new VouchNode({ seed: config.node.seed, notary: config.node.notary, journal, accountLog });

  const audit = new MemoryAudit();
  const custody = new Custody(config.master, config.salt, node, audit);

  // Read model: delegate to the engine's read-only observation surface.
  const observation = createObservationApp(node.world);
  const read = async (path: string): Promise<unknown> => {
    const res = await observation.fetch(new Request(`http://vouch.local${path}`));
    return res.json();
  };

  // Token verification key resolver: an external IdP's JWKS, or the bundled dev-AS's
  // signing key resolved once in-process and wrapped so both present as a get-key fn.
  // The dev-AS is mounted ONLY on the config's explicit, loopback-gated opt-in.
  const devAs = config.devAs ? new DevAuthServer(config.issuer, config.resource, config.scopesSupported) : null;
  let key: VerifyKey;
  if (devAs) {
    const devKey = await devAs.publicKey();
    key = async () => devKey;
  } else if (config.external) {
    key = createRemoteJWKSet(new URL(config.external.jwksUri));
  } else {
    throw new Error("config: no authorization server configured");
  }
  const verifier = makeVerifier({ issuer: config.issuer, audience: config.resource, key, custody });

  const app = new Hono();

  // DNS-rebinding guard. @hono/mcp does not validate Host/Origin, so we do it here for
  // EVERY route: a rebound browser page keeps its attacker hostname in Host/Origin even
  // after DNS points it at our loopback bind, so pinning both to the canonical origin
  // defeats it. Non-browser clients that hit the canonical URL pass; they send no Origin.
  const allowedHost = new URL(config.publicUrl).host;
  const allowedOrigin = config.publicUrl;
  app.use("*", async (c, next) => {
    const host = c.req.header("host");
    if (host && host !== allowedHost) return c.json(rpcError(`bad host "${host}"`), 421);
    const origin = c.req.header("origin");
    if (origin && origin !== allowedOrigin) return c.json(rpcError(`cross-origin request from "${origin}" refused`), 403);
    return next();
  });

  // RFC 9728 — protected resource metadata (path-inserted under /mcp, plus a root copy).
  const prm = () => protectedResourceMetadata(config.resource, config.issuer, config.scopesSupported);
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(prm()));
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(prm()));

  // Bundled dev Authorization Server (omitted when delegating to an external IdP).
  if (devAs) {
    app.get("/.well-known/oauth-authorization-server", (c) => c.json(devAs.metadata()));
    app.get("/jwks", async (c) => c.json(await devAs.jwks()));
    app.get("/authorize", (c) => {
      const r = devAs.authorize(new URL(c.req.url).searchParams);
      return "redirect" in r ? c.redirect(r.redirect) : c.json(r.body, r.status as 400);
    });
    app.post("/token", async (c) => {
      const form = new URLSearchParams(await c.req.text());
      const r = await devAs.token(form);
      return "access_token" in r ? c.json(r) : c.json(r.body, r.status as 400);
    });
  }

  // The bearer-protected MCP endpoint. One transport per session, bound to its principal.
  const sessions = new Map<string, { transport: StreamableHTTPTransport; principal: string }>();

  app.all("/mcp", async (c) => {
    const verify = await verifier(c.req.header("Authorization"));
    if (!verify.ok) {
      return c.body(null, verify.status, { "WWW-Authenticate": wwwAuthenticate(config.prmUrl, verify.error) });
    }
    const ctx = verify.ctx;
    const sid = c.req.header("mcp-session-id");

    if (c.req.method === "POST") {
      const body = await c.req.json().catch(() => undefined);
      if (sid) {
        const sess = sessions.get(sid);
        if (!sess) return c.json(rpcError("no such session"), 404);
        if (sess.principal !== ctx.principal) return c.json(rpcError("session principal mismatch"), 403);
        return (await sess.transport.handleRequest(c, body)) ?? c.body(null, 202);
      }
      if (isInitializeRequest(body)) {
        const transport = new StreamableHTTPTransport({ sessionIdGenerator: () => randomUUID(), enableJsonResponse: true });
        const server = buildMcpServer({ custody, read, serverInfo: SERVER_INFO }, ctx);
        await server.connect(transport);
        const response = await transport.handleRequest(c, body);
        // After the initialize round-trip the transport has minted its session id; bind
        // the session to this principal so later requests must present the same identity.
        if (transport.sessionId) {
          sessions.set(transport.sessionId, { transport, principal: ctx.principal });
          transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
          };
        }
        return response ?? c.body(null, 202);
      }
      return c.json(rpcError("missing mcp-session-id, or body is not an initialize request"), 400);
    }

    // GET (SSE stream) or DELETE (teardown) — must reference an existing, same-principal session.
    if (!sid) return c.json(rpcError("mcp-session-id required"), 400);
    const sess = sessions.get(sid);
    if (!sess) return c.json(rpcError("no such session"), 404);
    if (sess.principal !== ctx.principal) return c.json(rpcError("session principal mismatch"), 403);
    return (await sess.transport.handleRequest(c)) ?? c.body(null, 202);
  });

  return { app, node, custody, audit, devAs, config };
}
