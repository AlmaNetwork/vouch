// Local identity + config for the CLI.
//
// Non-custodial means the key is YOURS and lives on YOUR disk: the seed is stored in
// a 0600 keyfile (default ~/.vouch/key), and a small config.json remembers your node
// URL and the principal you last registered. Everything is overridable by env
// (VOUCH_NODE_URL / VOUCH_PRINCIPAL / VOUCH_KEYFILE / VOUCH_CONFIG_DIR) so the CLI is
// scriptable and testable without touching a real home directory.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { decodeBase64, encodeBase64, type KeyPair, keyPairFromSeed } from "vouch-core";

export type Env = Record<string, string | undefined>;

export interface CliConfig {
  readonly nodeUrl: string;
  readonly principal: string | null;
  readonly keyfile: string;
  readonly configPath: string;
  readonly timeoutMs: number;
}

const DEFAULT_NODE_URL = "http://127.0.0.1:8787";

function configDir(env: Env): string {
  return env.VOUCH_CONFIG_DIR ?? join(homedir(), ".vouch");
}

export function loadConfig(env: Env): CliConfig {
  const dir = configDir(env);
  const configPath = join(dir, "config.json");
  let stored: { nodeUrl?: string; principal?: string } = {};
  if (existsSync(configPath)) {
    try {
      stored = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      // A corrupt config is non-fatal — fall back to defaults + env.
    }
  }
  const t = Number(env.VOUCH_TIMEOUT_MS);
  return {
    nodeUrl: env.VOUCH_NODE_URL ?? stored.nodeUrl ?? DEFAULT_NODE_URL,
    principal: env.VOUCH_PRINCIPAL ?? stored.principal ?? null,
    keyfile: env.VOUCH_KEYFILE ?? join(dir, "key"),
    configPath,
    timeoutMs: Number.isFinite(t) && t > 0 ? t : 10_000,
  };
}

/** Merge a patch into the on-disk config.json (creating the dir if needed). */
export function saveConfig(cfg: CliConfig, patch: { nodeUrl?: string; principal?: string }): void {
  mkdirSync(dirname(cfg.configPath), { recursive: true });
  let current: Record<string, unknown> = {};
  if (existsSync(cfg.configPath)) {
    try {
      current = JSON.parse(readFileSync(cfg.configPath, "utf8"));
    } catch {
      current = {};
    }
  }
  writeFileSync(cfg.configPath, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`);
}

export function keyExists(cfg: CliConfig): boolean {
  return existsSync(cfg.keyfile);
}

/** Create a fresh Ed25519 seed and write it 0600. Refuses to clobber an existing key. */
export function generateKey(cfg: CliConfig): KeyPair {
  if (existsSync(cfg.keyfile)) throw new Error(`a key already exists at ${cfg.keyfile} (refusing to overwrite)`);
  const seed = new Uint8Array(randomBytes(32));
  mkdirSync(dirname(cfg.keyfile), { recursive: true });
  writeFileSync(cfg.keyfile, `${encodeBase64(seed)}\n`, { mode: 0o600 });
  return keyPairFromSeed(seed);
}

export function loadKey(cfg: CliConfig): KeyPair {
  if (!existsSync(cfg.keyfile)) throw new Error(`no key at ${cfg.keyfile} — run: vouch keygen`);
  let seed: Uint8Array;
  try {
    seed = decodeBase64(readFileSync(cfg.keyfile, "utf8").trim());
  } catch {
    throw new Error(`keyfile ${cfg.keyfile} is not valid base64`);
  }
  if (seed.length !== 32) throw new Error(`keyfile ${cfg.keyfile} is not a 32-byte seed (got ${seed.length})`);
  return keyPairFromSeed(seed);
}
