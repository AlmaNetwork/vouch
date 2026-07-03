import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { generateKey, keyExists, loadConfig, loadKey, saveConfig } from "../src/config";
import { tmpConfigDir } from "./helpers";

describe("cli config + local key", () => {
  test("loadConfig falls back to defaults on a corrupt config.json", () => {
    const t = tmpConfigDir();
    try {
      const cfg = loadConfig({ VOUCH_CONFIG_DIR: t.dir });
      writeFileSync(cfg.configPath, "{ not json");
      const reloaded = loadConfig({ VOUCH_CONFIG_DIR: t.dir });
      expect(reloaded.nodeUrl).toContain("http");
      expect(reloaded.principal).toBeNull();
    } finally {
      t.cleanup();
    }
  });

  test("saveConfig merges into an existing (even corrupt) config", () => {
    const t = tmpConfigDir();
    try {
      const cfg = loadConfig({ VOUCH_CONFIG_DIR: t.dir });
      writeFileSync(cfg.configPath, "{ broken");
      saveConfig(cfg, { principal: "alice" });
      expect(loadConfig({ VOUCH_CONFIG_DIR: t.dir }).principal).toBe("alice");
    } finally {
      t.cleanup();
    }
  });

  test("VOUCH_TIMEOUT_MS is parsed, with a sane default", () => {
    const t = tmpConfigDir();
    try {
      expect(loadConfig({ VOUCH_CONFIG_DIR: t.dir, VOUCH_TIMEOUT_MS: "2500" }).timeoutMs).toBe(2500);
      expect(loadConfig({ VOUCH_CONFIG_DIR: t.dir, VOUCH_TIMEOUT_MS: "nope" }).timeoutMs).toBe(10_000);
      expect(loadConfig({ VOUCH_CONFIG_DIR: t.dir }).timeoutMs).toBe(10_000);
    } finally {
      t.cleanup();
    }
  });

  test("keygen round-trips through loadKey and refuses to clobber", () => {
    const t = tmpConfigDir();
    try {
      const cfg = loadConfig({ VOUCH_CONFIG_DIR: t.dir });
      expect(keyExists(cfg)).toBe(false);
      const kp = generateKey(cfg);
      expect(keyExists(cfg)).toBe(true);
      expect(loadKey(cfg).publicKey).toEqual(kp.publicKey);
      expect(() => generateKey(cfg)).toThrow(/already exists/);
    } finally {
      t.cleanup();
    }
  });

  test("loadKey rejects a missing or malformed keyfile", () => {
    const t = tmpConfigDir();
    try {
      const cfg = loadConfig({ VOUCH_CONFIG_DIR: t.dir });
      expect(() => loadKey(cfg)).toThrow(/no key/);
      writeFileSync(cfg.keyfile, Buffer.from("tooShort").toString("base64"));
      expect(() => loadKey(cfg)).toThrow(/32-byte/);
    } finally {
      t.cleanup();
    }
  });
});
