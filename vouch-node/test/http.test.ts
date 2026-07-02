import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { MemoryAccountLog } from "../src/accounts";
import { createNodeApp } from "../src/http";
import { MemoryJournal } from "../src/journal";
import { VouchNode } from "../src/node";
import { keypair, signCommand, signRegister } from "./helpers";

function makeApp(): Hono {
  const node = new VouchNode({ seed: "h", notary: keypair(7), journal: new MemoryJournal(), accountLog: new MemoryAccountLog() });
  return createNodeApp(node);
}

async function post(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("node HTTP surface", () => {
  test("register + command over HTTP, then the write shows up on the read surface", async () => {
    const app = makeApp();

    const reg = await post(app, "/v1/register", signRegister("acct:alice", 0, keypair(1)));
    expect(reg.status).toBe(200);

    const cmd = await post(
      app,
      "/v1/command",
      signCommand("acct:alice", 1, { kind: "found", regionId: "nova", displayName: "Nova" }, keypair(1)),
    );
    expect(cmd.status).toBe(200);

    const regions = await app.request("/regions");
    expect(regions.status).toBe(200);
    const body = (await regions.json()) as Array<{ id: string; owner: string | null }>;
    const nova = body.find((r) => r.id === "nova");
    expect(nova?.owner).toBe("acct:alice");
  });

  test("an unauthenticated command is rejected (401)", async () => {
    const app = makeApp();
    const res = await post(
      app,
      "/v1/command",
      signCommand("acct:ghost", 1, { kind: "found", regionId: "x", displayName: "X" }, keypair(9)),
    );
    expect(res.status).toBe(401);
  });

  test("failures use the uniform error envelope with a code + request id", async () => {
    const app = makeApp();
    const res = await post(
      app,
      "/v1/command",
      signCommand("acct:ghost", 1, { kind: "found", regionId: "x", displayName: "X" }, keypair(9)),
    );
    expect(res.status).toBe(401);
    const rid = res.headers.get("x-request-id");
    if (!rid) throw new Error("missing x-request-id header");
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string; requestId: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("unregistered-principal");
    expect(body.error.message).toBe("unregistered principal"); // human form of the code
    expect(body.error.requestId).toBe(rid); // body + header agree
  });

  test("a successful write carries a request id (header + body)", async () => {
    const app = makeApp();
    const reg = await post(app, "/v1/register", signRegister("acct:alice", 0, keypair(1)));
    expect(reg.status).toBe(200);
    const rid = reg.headers.get("x-request-id");
    if (!rid) throw new Error("missing x-request-id header");
    expect(((await reg.json()) as { requestId: string }).requestId).toBe(rid);
  });

  test("a non-JSON body is rejected (400)", async () => {
    const app = makeApp();
    const res = await app.request("/v1/command", { method: "POST", headers: { "content-type": "application/json" }, body: "not json" });
    expect(res.status).toBe(400);
  });

  test("the read surface stays available (GET /health)", async () => {
    const app = makeApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toMatchObject({ ok: true });
  });
});
