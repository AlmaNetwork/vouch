// The vouch-web BFF — a tiny read-only proxy in front of a vouch-node.
//
// The browser is same-origin with this server, so it never hits CORS: this server
// serves the viewer page and forwards a fixed ALLOW-LIST of vouch-node's read-only
// observation endpoints under /api/*. It NEVER proxies the write path (/v1/*), and it
// only forwards GETs — the GUI is a viewer. Signing/participation stays in the CLI /
// MCP clients; a future write-capable GUI would sign in the browser and post directly.

/** The read-only observation endpoints the viewer may reach (prefix match). Writes are never proxied. */
const ALLOWED = ["/regions", "/agents", "/state", "/metrics", "/log", "/health"] as const;

function isAllowedRead(pathname: string): boolean {
  return ALLOWED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export interface HandlerDeps {
  readonly nodeUrl: string;
  readonly indexHtml: string;
  readonly timeoutMs?: number;
}

/** Build the request handler (exported so it can be unit-tested without binding a port). */
export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const timeoutMs = deps.timeoutMs ?? 5_000;
  return async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(deps.indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (url.pathname.startsWith("/api/")) {
      const target = url.pathname.slice("/api".length); // /api/regions -> /regions
      if (req.method !== "GET") return json({ error: "read-only: only GET is proxied" }, 405);
      if (!isAllowedRead(target)) return json({ error: `not a permitted read: ${target}` }, 403);
      try {
        const upstream = await fetch(`${deps.nodeUrl}${target}${url.search}`, { signal: AbortSignal.timeout(timeoutMs) });
        return new Response(await upstream.text(), {
          status: upstream.status,
          headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
        });
      } catch (e) {
        return json({ error: `vouch-node unreachable at ${deps.nodeUrl}: ${e instanceof Error ? e.message : String(e)}` }, 502);
      }
    }

    return json({ error: "not found" }, 404);
  };
}
