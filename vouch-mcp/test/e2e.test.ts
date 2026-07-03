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
});
