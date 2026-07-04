// End-to-end tour, over MCP + OAuth 2.1: a founder and a joiner participate in a
// vouch world entirely through their MCP client, with the node custodially signing
// on each authenticated subject's behalf. Run: `bun examples/connect.ts`.
//
// It is self-contained: it boots the server in-process (bundled dev-AS), runs the
// authorization-code + PKCE dance for two subjects, and drives the tools — including
// the owner-gated "join" and a scope-denied write — then prints the sign audit log.

import { connectMcp, fetchDevToken, toolText } from "../src/client";
import { loadMcpConfig } from "../src/config";
import { createMcpApp } from "../src/server";

// Dev-only secrets; production sets these for real (VOUCH_MCP_MASTER_SECRET has no fallback).
process.env.VOUCH_NOTARY ??= "seed://vouch-mcp-demo-notary";
process.env.VOUCH_MCP_MASTER_SECRET ??= "demo-master-secret-please-change";
process.env.VOUCH_MCP_PORT ??= "8788";
process.env.VOUCH_MCP_DEV_AS ??= "1"; // opt in to the bundled passwordless dev-AS (loopback only)

const config = loadMcpConfig(process.env);
const { app, audit } = await createMcpApp(config);
const server = Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch });
const base = `http://${config.host}:${config.port}`;
const call = async (client: Awaited<ReturnType<typeof connectMcp>>, name: string, args: Record<string, unknown>) =>
  toolText(await client.callTool({ name, arguments: args }));

try {
  console.log("幕0: bob が MCP でログイン (read+transfer+vouch scope) して自分の identity を知る");
  const bobTok = await fetchDevToken({
    baseUrl: base,
    resource: config.resource,
    scopes: ["vouch:read", "vouch:transfer", "vouch:vouch"],
    sub: "bob",
  });
  const bob = await connectMcp(base, bobTok.access_token);
  const bobSlug = JSON.parse(await call(bob, "vouch_whoami", {})).principal as string;
  const bobInNova = `${bobSlug}@nova`; // bob's resident agent id once admitted into nova
  console.log(`  bob token scope: "${bobTok.scope}"`);
  console.log(`  bob slug:        ${bobSlug}   (住民idは nova で ${bobInNova})`);

  console.log("\n幕1: alice が MCP でログイン (全scope) して建国");
  const aliceTok = await fetchDevToken({ baseUrl: base, resource: config.resource, scopes: config.scopesSupported, sub: "alice" });
  const alice = await connectMcp(base, aliceTok.access_token);
  console.log("  alice found nova ->", await call(alice, "vouch_found_region", { regionId: "nova", displayName: "Nova" }));

  console.log("\n幕2: bob はまだ住民ちゃう → 送金は弾かれる");
  console.log("  bob transfer(未入村) ->", await call(bob, "vouch_transfer", { region: "nova", to: "market@nova", amount: 10 }));

  console.log("\n幕3: owner alice が bob と market を admit (= 入村)");
  console.log(
    "  admit bob ->",
    await call(alice, "vouch_admit_agent", { agentId: bobInNova, region: "nova", role: "merchant", currency: 50 }),
  );
  console.log(
    "  admit market ->",
    await call(alice, "vouch_admit_agent", { agentId: "market@nova", region: "nova", role: "broker", currency: 0 }),
  );

  console.log("\n幕4: bob が住民として活動");
  console.log("  bob transfer 20 -> market ->", await call(bob, "vouch_transfer", { region: "nova", to: "market@nova", amount: 20 }));
  console.log("  bob vouch market(3) ->", await call(bob, "vouch_vouch", { region: "nova", to: "market@nova", weight: 3 }));

  console.log("\n幕5: scope ゲート実演 — bob は建国scopeを持ってない");
  console.log("  bob found(scope無し) ->", await call(bob, "vouch_found_region", { regionId: "x", displayName: "X" }));

  console.log("\n結果: alice が住民一覧を読む");
  console.log(await call(alice, "vouch_list_agents", {}));

  console.log("\n監査ログ (custodial署名の証跡 — トークンや鍵は載せない):");
  for (const e of audit.entries()) {
    console.log(
      `  ${e.outcome.padEnd(12)} ${e.commandKind.padEnd(9)} sub=${e.sub.padEnd(6)} nonce=${String(e.nonce).padStart(2)}  ${e.reason ?? ""}`,
    );
  }

  await bob.close();
  await alice.close();
} finally {
  server.stop();
}
