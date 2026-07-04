import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHandler } from "../src/server";

const INDEX = "<!doctype html><title>viewer</title>";
let upstream: ReturnType<typeof Bun.serve>;
let nodeUrl: string;

beforeAll(() => {
  // A stub "vouch-node" observation surface.
  upstream = Bun.serve({
    port: 8811,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/regions") return Response.json([{ id: "nova", displayName: "Nova" }]);
      if (u.pathname === "/agents") return Response.json([{ id: "bob@nova", balances: { currency: 30 }, trust: 3 }]);
      if (u.pathname === "/log")
        return Response.json([{ seq: Number(u.searchParams.get("since") ?? 0), type: "x", actor: "world", payload: {} }]);
      return new Response("not found", { status: 404 });
    },
  });
  nodeUrl = `http://127.0.0.1:${upstream.port}`;
});
afterAll(() => upstream.stop(true));

const get = (path: string, init?: RequestInit) =>
  createHandler({ nodeUrl, indexHtml: INDEX })(new Request(`http://web.local${path}`, init));

describe("vouch-web BFF", () => {
  test("serves the viewer at / and /index.html", async () => {
    expect(await (await get("/")).text()).toContain("viewer");
    expect((await get("/index.html")).status).toBe(200);
    expect((await get("/index.html")).headers.get("content-type")).toContain("text/html");
  });

  test("proxies allow-listed reads under /api/*", async () => {
    const r = await get("/api/regions");
    expect(r.status).toBe(200);
    expect(((await r.json()) as Array<{ id: string }>)[0]?.id).toBe("nova");
    expect(((await (await get("/api/agents")).json()) as Array<{ trust: number }>)[0]?.trust).toBe(3);
  });

  test("forwards the query string (e.g. /log?since=)", async () => {
    const r = await get("/api/log?since=5");
    expect(((await r.json()) as Array<{ seq: number }>)[0]?.seq).toBe(5);
  });

  test("never proxies the write path", async () => {
    expect((await get("/api/v1/command")).status).toBe(403);
    expect((await get("/api/v1/register")).status).toBe(403);
  });

  test("only GET is proxied (viewer is read-only)", async () => {
    expect((await get("/api/regions", { method: "POST" })).status).toBe(405);
  });

  test("unknown paths → 404", async () => {
    expect((await get("/nope")).status).toBe(404);
  });

  test("upstream down → 502 with a clear message", async () => {
    const down = createHandler({ nodeUrl: "http://127.0.0.1:1", indexHtml: INDEX, timeoutMs: 800 });
    const r = await down(new Request("http://web.local/api/regions"));
    expect(r.status).toBe(502);
    expect((await r.json()) as { error: string }).toHaveProperty("error");
  });
});
