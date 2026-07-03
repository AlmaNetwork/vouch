// A terminal tour: two people participate in a vouch world purely through the CLI,
// each holding their OWN key (non-custodial). Boots an in-process vouch-node so it is
// self-contained. Run: `bun examples/tour.ts`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keyPairFromSeed } from "vouch-core";
import { createNodeApp, MemoryAccountLog, MemoryJournal, VouchNode } from "vouch-node";
import { formatEvent, type Io, run } from "../src/cli";
import { VouchClient } from "../src/client";
import type { Env } from "../src/config";

const node = new VouchNode({
  seed: "cli-tour",
  notary: keyPairFromSeed(new Uint8Array(32).fill(9)),
  journal: new MemoryJournal(),
  accountLog: new MemoryAccountLog(),
});
const server = Bun.serve({ hostname: "127.0.0.1", port: 8787, fetch: createNodeApp(node).fetch });
const base = `http://127.0.0.1:${server.port}`;

const aliceDir = mkdtempSync(join(tmpdir(), "vouch-alice-"));
const bobDir = mkdtempSync(join(tmpdir(), "vouch-bob-"));
const aliceEnv: Env = { VOUCH_NODE_URL: base, VOUCH_CONFIG_DIR: aliceDir };
const bobEnv: Env = { VOUCH_NODE_URL: base, VOUCH_CONFIG_DIR: bobDir };
const io: Io = { out: (l) => console.log(`  ${l}`), err: (l) => console.log(`  ! ${l}`) };

async function vouch(env: Env, ...args: string[]): Promise<void> {
  console.log(`\n$ vouch ${args.join(" ")}`);
  await run(args, env, io);
}

try {
  console.log("=== alice (founder) — holds her own key ===");
  await vouch(aliceEnv, "keygen");
  await vouch(aliceEnv, "register", "alice");
  await vouch(aliceEnv, "found", "nova", "Nova");

  console.log("\n=== bob (joiner) — holds his own key ===");
  await vouch(bobEnv, "keygen");
  await vouch(bobEnv, "register", "bob@nova");
  await vouch(bobEnv, "transfer", "market@nova", "10"); // rejected: not admitted yet

  console.log("\n=== alice admits (owner-gated join) ===");
  await vouch(aliceEnv, "admit", "bob@nova", "nova", "merchant", "--currency", "50");
  await vouch(aliceEnv, "admit", "market@nova", "nova", "broker");

  console.log("\n=== bob acts as a resident ===");
  await vouch(bobEnv, "transfer", "market@nova", "20");
  await vouch(bobEnv, "vouch", "market@nova", "3");
  await vouch(bobEnv, "whoami");

  console.log("\n=== the village newspaper (what `vouch watch` tails) ===");
  for (const e of await new VouchClient(base).log(0)) console.log(`  ${formatEvent(e)}`);
} finally {
  server.stop(true);
  rmSync(aliceDir, { recursive: true, force: true });
  rmSync(bobDir, { recursive: true, force: true });
}
