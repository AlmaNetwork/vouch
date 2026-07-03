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
});
