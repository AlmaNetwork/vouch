// End-to-end over real HTTP: the OAuth 2.1 dance + an MCP client driving the tools.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectMcp, fetchDevToken, toolText } from "../src/client";
import type { McpApp } from "../src/server";
import { bootTestServer } from "./helpers";

const PORT = 8790;
let base: string;
let resource: string;
let scopesSupported: string[];
let app: McpApp;
let stop: () => void;

beforeAll(async () => {
  const s = await bootTestServer(PORT);
  base = s.base;
  resource = s.config.resource;
  scopesSupported = s.config.scopesSupported;
  app = s.app;
  stop = s.stop;
});
afterAll(() => stop());

const token = async (scopes: string[], sub: string): Promise<string> =>
  (await fetchDevToken({ baseUrl: base, resource, scopes, sub })).access_token;

const ACCEPT = "application/json, text/event-stream";

/** Raw MCP initialize; returns the minted session id (for session-lifecycle tests). */
async function rawInitialize(tok: string): Promise<string | null> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", accept: ACCEPT },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
    }),
  });
  return res.headers.get("mcp-session-id");
}

describe("discovery / auth gate", () => {
  test("unauthenticated /mcp → 401 with a WWW-Authenticate challenge", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate") ?? "").toContain("resource_metadata=");
  });

  test("protected-resource-metadata is served for discovery", async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    const body = (await res.json()) as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe(resource);
    expect(body.authorization_servers.length).toBeGreaterThan(0);
  });

  test("authorization-server metadata is served", async () => {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
    const body = (await res.json()) as { code_challenge_methods_supported: string[] };
    expect(body.code_challenge_methods_supported).toContain("S256");
  });
});

describe("participation over MCP", () => {
  test("found → join (owner admits) → transfer → vouch, all custodially signed", async () => {
    const bob = await connectMcp(base, await token(["vouch:read", "vouch:transfer", "vouch:vouch"], "bob"));
    const bobSlug = (JSON.parse(toolText(await bob.callTool({ name: "vouch_whoami", arguments: {} }))) as { principal: string }).principal;
    const bobInNova = `${bobSlug}@nova`;

    const alice = await connectMcp(base, await token(scopesSupported, "alice"));
    const found = JSON.parse(
      toolText(await alice.callTool({ name: "vouch_found_region", arguments: { regionId: "nova", displayName: "Nova" } })),
    );
    expect(found.ok).toBe(true);

    // bob cannot act before being admitted
    const early = await bob.callTool({ name: "vouch_transfer", arguments: { region: "nova", to: "market@nova", amount: 5 } });
    expect(toolText(early)).toContain("unknown-agent");

    // the owner admits bob (his resident id) and a market counterparty
    const admitBob = JSON.parse(
      toolText(
        await alice.callTool({
          name: "vouch_admit_agent",
          arguments: { agentId: bobInNova, region: "nova", role: "merchant", currency: 50 },
        }),
      ),
    );
    expect(admitBob.ok).toBe(true);
    const admitMarket = JSON.parse(
      toolText(
        await alice.callTool({
          name: "vouch_admit_agent",
          arguments: { agentId: "market@nova", region: "nova", role: "broker", currency: 0 },
        }),
      ),
    );
    expect(admitMarket.ok).toBe(true);

    // now bob is a full resident
    expect(
      JSON.parse(toolText(await bob.callTool({ name: "vouch_transfer", arguments: { region: "nova", to: "market@nova", amount: 20 } }))).ok,
    ).toBe(true);
    expect(
      JSON.parse(toolText(await bob.callTool({ name: "vouch_vouch", arguments: { region: "nova", to: "market@nova", weight: 3 } }))).ok,
    ).toBe(true);

    // read back + conservation: the 50 seeded to bob is neither created nor destroyed
    const agents = JSON.parse(toolText(await alice.callTool({ name: "vouch_list_agents", arguments: {} }))) as Array<{
      id: string;
      region: string;
      balances: { currency: number };
      trust: number;
    }>;
    const nova = agents.filter((a) => a.region === "nova");
    expect(nova.reduce((n, a) => n + a.balances.currency, 0)).toBe(50);
    expect(nova.find((a) => a.id === bobInNova)?.balances.currency).toBe(30);
    expect(nova.find((a) => a.id === "market@nova")?.trust).toBe(3);

    // the sign audit attributes each signature back to the token that caused it (jti present)
    const acceptedTransfer = app.audit.entries().find((e) => e.commandKind === "transfer" && e.outcome === "accepted");
    expect(acceptedTransfer?.jti).toBeTruthy();

    await bob.close();
    await alice.close();
  });

  test("a read-only token cannot sign a write (scope gate)", async () => {
    const reader = await connectMcp(base, await token(["vouch:read"], "reader"));
    const r = await reader.callTool({ name: "vouch_found_region", arguments: { regionId: "zed", displayName: "Zed" } });
    expect(r.isError).toBe(true);
    expect(toolText(r)).toContain("insufficient_scope");
    await reader.close();
  });

  test("world state is exposed as MCP resources", async () => {
    const c = await connectMcp(base, await token(["vouch:read"], "res-reader"));
    const regions = (await c.readResource({ uri: "vouch://regions" })) as { contents: Array<{ mimeType?: string; text?: string }> };
    expect(regions.contents[0]?.mimeType).toBe("application/json");
    const me = (await c.readResource({ uri: "vouch://me" })) as { contents: Array<{ text?: string }> };
    expect((JSON.parse(me.contents[0]?.text ?? "{}") as { principal?: string }).principal).toBeTruthy();
    await c.close();
  });

  test("ships a participant manual: instructions on connect + a vouch://guide resource", async () => {
    const c = await connectMcp(base, await token(["vouch:read"], "manual-reader"));

    // instructions ride the initialize handshake and are surfaced to the model on connect.
    const instructions = c.getInstructions() ?? "";
    expect(instructions).toMatch(/vouch_found_region/);
    expect(instructions).toMatch(/conserved/i);

    // the guide resource is markdown and states the load-bearing rules + the worked example.
    const guide = (await c.readResource({ uri: "vouch://guide" })) as { contents: Array<{ mimeType?: string; text?: string }> };
    expect(guide.contents[0]?.mimeType).toBe("text/markdown");
    const text = guide.contents[0]?.text ?? "";
    expect(text).toContain("Conservation");
    expect(text).toContain("worked example");

    await c.close();
  });
});

describe("hardening / non-functional", () => {
  test("GET /health is a cheap unauthenticated liveness probe", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  test("an oversized request body is rejected (413) before any auth", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(300 * 1024),
    });
    expect(res.status).toBe(413);
  });

  test("a session may only be driven by the principal that opened it", async () => {
    const sid = await rawInitialize(await token(["vouch:read"], "sess-owner"));
    expect(sid).toBeTruthy();
    const intruder = await token(["vouch:read"], "sess-intruder");
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${intruder}`, "content-type": "application/json", accept: ACCEPT, "mcp-session-id": sid ?? "" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(res.status).toBe(403);
  });

  test("an unknown session id → 404", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await token(["vouch:read"], "ghost")}`,
        "content-type": "application/json",
        accept: ACCEPT,
        "mcp-session-id": "nope",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(404);
  });

  test("DELETE tears a session down", async () => {
    const tok = await token(["vouch:read"], "del-user");
    const sid = await rawInitialize(tok);
    const res = await fetch(`${base}/mcp`, { method: "DELETE", headers: { authorization: `Bearer ${tok}`, "mcp-session-id": sid ?? "" } });
    expect(res.ok).toBe(true);
  });

  test("a non-initialize POST without a session id → 400", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${await token(["vouch:read"], "no-sess")}`, "content-type": "application/json", accept: ACCEPT },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Claude Code / dynamic client registration flow", () => {
  test("AS metadata advertises the registration endpoint + issuer identification", async () => {
    const md = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as {
      registration_endpoint: string;
      authorization_response_iss_parameter_supported: boolean;
    };
    expect(md.registration_endpoint).toMatch(/\/register$/);
    expect(md.authorization_response_iss_parameter_supported).toBe(true);
  });

  test("POST /register mints a client_id (RFC 7591)", async () => {
    const res = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude Code",
        redirect_uris: ["http://127.0.0.1:8080/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(res.status).toBe(201);
    expect(typeof ((await res.json()) as { client_id: string }).client_id).toBe("string");
  });

  test("/authorize serves a consent page to a browser (Accept: text/html)", async () => {
    const url = `${base}/authorize?response_type=code&client_id=x&redirect_uri=http://127.0.0.1:8080/cb&code_challenge=abc&code_challenge_method=S256&scope=vouch:read&resource=${encodeURIComponent(resource)}`;
    const res = await fetch(url, { headers: { accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    expect((await res.text()).toLowerCase()).toContain("authorize");
  });

  test("a DCR-registered client completes the whole flow and can drive tools", async () => {
    const reg = (await (
      await fetch(`${base}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["http://127.0.0.1:53682/callback"], token_endpoint_auth_method: "none" }),
      })
    ).json()) as { client_id: string };
    const tok = await fetchDevToken({ baseUrl: base, resource, scopes: ["vouch:read"], sub: "dcr-user", clientId: reg.client_id });
    expect(tok.access_token.split(".").length).toBe(3);
    const c = await connectMcp(base, tok.access_token);
    const who = JSON.parse(toolText(await c.callTool({ name: "vouch_whoami", arguments: {} }))) as { principal: string };
    expect(who.principal).toBeTruthy();
    await c.close();
  });
});
