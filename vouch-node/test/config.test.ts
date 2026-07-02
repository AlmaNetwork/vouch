import { describe, expect, test } from "bun:test";
import { loadConfig, resolveNotary } from "../src/config";

describe("loadConfig — notary has no silent fallback", () => {
  test("throws when VOUCH_NOTARY is unset (no well-known key)", () => {
    expect(() => loadConfig({})).toThrow(/VOUCH_NOTARY is required/);
  });

  test("boots with an explicit seed:// source and loopback defaults", () => {
    const cfg = loadConfig({ VOUCH_NOTARY: "seed://dev-secret" });
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.port).toBe(8787);
    expect(cfg.notary.publicKey.length).toBe(32);
  });

  test("range-checks the port", () => {
    expect(() => loadConfig({ VOUCH_NOTARY: "seed://x", VOUCH_PORT: "99999" })).toThrow(/VOUCH_PORT/);
    expect(() => loadConfig({ VOUCH_NOTARY: "seed://x", VOUCH_PORT: "0x50" })).toThrow(/VOUCH_PORT/);
  });
});

describe("resolveNotary", () => {
  test("env:// with a set variable derives a key", () => {
    const kp = resolveNotary("env://SECRET", { SECRET: "hunter2" });
    expect(kp.publicKey.length).toBe(32);
  });

  test("env:// with an unset/empty variable throws (no fallback)", () => {
    expect(() => resolveNotary("env://SECRET", {})).toThrow(/unset or empty/);
    expect(() => resolveNotary("env://SECRET", { SECRET: "" })).toThrow(/unset or empty/);
  });

  test("an unknown scheme is rejected", () => {
    expect(() => resolveNotary("http://evil", {})).toThrow(/unknown notary source scheme/);
    expect(() => resolveNotary("no-scheme", {})).toThrow(/must be seed:\/\/… or env:\/\/…/);
  });

  test("the same source is deterministic", () => {
    const a = resolveNotary("seed://same", {});
    const b = resolveNotary("seed://same", {});
    expect(a.publicKey).toEqual(b.publicKey);
  });
});
