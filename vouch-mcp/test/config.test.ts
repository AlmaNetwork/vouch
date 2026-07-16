import { describe, expect, test } from "bun:test";
import { loadMcpConfig } from "../src/config";

const base = { VOUCH_NOTARY: "seed://test-notary", VOUCH_MCP_MASTER_SECRET: "0123456789abcdefX" };

describe("config — dev-AS gating (fail closed)", () => {
  test("refuses to boot with no external IdP and no dev opt-in", () => {
    expect(() => loadMcpConfig({ ...base })).toThrow(/no authorization server/);
  });

  test("mounts the dev-AS only on explicit opt-in + a loopback bind", () => {
    const c = loadMcpConfig({ ...base, VOUCH_MCP_DEV_AS: "1" });
    expect(c.devAs).toBe(true);
    expect(c.external).toBeNull();
  });

  test("refuses the passwordless dev-AS on a non-loopback bind", () => {
    expect(() => loadMcpConfig({ ...base, VOUCH_MCP_DEV_AS: "1", VOUCH_MCP_HOST: "0.0.0.0" })).toThrow(/non-loopback/);
  });

  test("an external IdP disables the dev-AS and may bind publicly", () => {
    const c = loadMcpConfig({
      ...base,
      VOUCH_MCP_HOST: "0.0.0.0",
      VOUCH_MCP_AS_ISSUER: "https://idp.example",
      VOUCH_MCP_AS_JWKS_URL: "https://idp.example/.well-known/jwks.json",
    });
    expect(c.devAs).toBe(false);
    expect(c.external).not.toBeNull();
  });

  test("the master secret has no fallback and a minimum length", () => {
    expect(() => loadMcpConfig({ VOUCH_NOTARY: "seed://t" })).toThrow(/VOUCH_MCP_MASTER_SECRET is required/);
    expect(() => loadMcpConfig({ VOUCH_NOTARY: "seed://t", VOUCH_MCP_MASTER_SECRET: "short" })).toThrow(/at least 16/);
  });

  test("the public URL must be an absolute URL without a fragment", () => {
    expect(() => loadMcpConfig({ ...base, VOUCH_MCP_DEV_AS: "1", VOUCH_MCP_PUBLIC_URL: "not-a-url" })).toThrow(/absolute URL/);
    expect(() => loadMcpConfig({ ...base, VOUCH_MCP_DEV_AS: "1", VOUCH_MCP_PUBLIC_URL: "http://127.0.0.1:8788/mcp#frag" })).toThrow(
      /fragment/,
    );
  });

  test("VOUCH_MCP_AS_ISSUER and _JWKS_URL must be set together", () => {
    expect(() => loadMcpConfig({ ...base, VOUCH_MCP_AS_ISSUER: "https://idp.example" })).toThrow(/must be set together/);
  });

  test("VOUCH_MCP_PORT must be a decimal integer in range", () => {
    expect(() => loadMcpConfig({ ...base, VOUCH_MCP_DEV_AS: "1", VOUCH_MCP_PORT: "0x50" })).toThrow(/decimal integer/);
    expect(() => loadMcpConfig({ ...base, VOUCH_MCP_DEV_AS: "1", VOUCH_MCP_PORT: "99999" })).toThrow(/in \[/);
  });
});
