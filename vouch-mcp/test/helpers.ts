// Test helpers: build a config, an in-process node, and (for e2e) a live server.

import { createHash, randomBytes } from "node:crypto";
import { keyPairFromSeed } from "vouch-core";
import { MemoryAccountLog, MemoryJournal, VouchNode } from "vouch-node";
import { MemoryAudit } from "../src/audit";
import { loadMcpConfig, type McpConfig } from "../src/config";
import { Custody } from "../src/custody";
import { createMcpApp, type McpApp } from "../src/server";

const NOTARY_SEED = new Uint8Array(32).fill(7);

export function testEnv(port: number, extra: Record<string, string> = {}): Record<string, string> {
  return {
    VOUCH_NOTARY: "seed://vouch-mcp-test-notary",
    VOUCH_MCP_MASTER_SECRET: "vouch-mcp-test-master-secret-0123456789",
    VOUCH_MCP_PORT: String(port),
    VOUCH_MCP_DEV_AS: "1", // opt in to the bundled passwordless dev-AS (loopback bind)
    ...extra,
  };
}

export function testConfig(port: number, extra: Record<string, string> = {}): McpConfig {
  return loadMcpConfig(testEnv(port, extra));
}

/** A bare Custody wired to a fresh in-memory node — for unit tests that don't need HTTP. */
export function makeCustody(): { custody: Custody; node: VouchNode; audit: MemoryAudit } {
  const node = new VouchNode({
    seed: "test",
    notary: keyPairFromSeed(NOTARY_SEED),
    journal: new MemoryJournal(),
    accountLog: new MemoryAccountLog(),
  });
  const audit = new MemoryAudit();
  const master = new TextEncoder().encode("unit-test-master-secret-0123456789");
  const salt = new TextEncoder().encode("unit-test-salt");
  return { custody: new Custody(master, salt, node, audit), node, audit };
}

export async function bootTestServer(
  port: number,
  extra: Record<string, string> = {},
): Promise<{ app: McpApp; base: string; config: McpConfig; stop: () => void }> {
  const config = testConfig(port, extra);
  const app = await createMcpApp(config);
  const server = Bun.serve({ hostname: config.host, port: config.port, fetch: app.app.fetch });
  return { app, base: `http://${config.host}:${config.port}`, config, stop: () => server.stop(true) };
}

/** PKCE S256 pair for driving the dev-AS directly. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
