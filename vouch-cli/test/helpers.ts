// Test helpers: an in-process vouch-node to talk to, a throwaway config dir, and an
// IO sink that captures the CLI's output.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keyPairFromSeed } from "vouch-core";
import { createNodeApp, MemoryAccountLog, MemoryJournal, VouchNode } from "vouch-node";
import type { Io } from "../src/cli";

export function bootNode(port: number): { base: string; stop: () => void } {
  const node = new VouchNode({
    seed: "cli-test",
    notary: keyPairFromSeed(new Uint8Array(32).fill(9)),
    journal: new MemoryJournal(),
    accountLog: new MemoryAccountLog(),
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: createNodeApp(node).fetch });
  return { base: `http://127.0.0.1:${port}`, stop: () => server.stop(true) };
}

export function tmpConfigDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "vouch-cli-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function captureIo(): { io: Io; out: string[]; err: string[]; text: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (l) => out.push(l), err: (l) => err.push(l) },
    out,
    err,
    text: () => [...out, ...err].join("\n"),
  };
}
