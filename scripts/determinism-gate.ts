// Track C — determinism + replay-equivalence GATE (task C6).
//
// An INDEPENDENT check (its own CI job, separate from `bun test`) that the REAL world
// composition — createAlmaWorld + the founding/admission/economy write path + runEconomy
// — upholds two invariants:
//   (a) Determinism: the same seed + same script produces an identical log digest.
//   (b) Replay-equivalence: replaying the log alone (replayState over rootReducer,
//       from INITIAL_WORLD_STATE) reproduces the live state exactly.
//
// The in-suite unit test (vouch-world/test/foundation/world.test.ts) proves these on a
// tiny demo domain; this gate fixes them on the PRODUCTION composition.
//
// SCOPE: this asserts on the CLOSED, in-process simulation only. A live node that accepts
// external commands (wall-clock arrival, network order, client-supplied entropy) needs a
// different contract — single-writer journaling so replay re-folds recorded commands —
// which is Track B's to guarantee. Do NOT extend this gate to a live write node without
// that contract (see the Track C brief, §6 high-3).
//
// Run: `bun scripts/determinism-gate.ts` (from repo root). Exits non-zero on any failure.

import { keyPairFromSeed } from "../vouch-core/src/index";
import {
  admitAgent,
  admitTreasury,
  createAlmaWorld,
  INITIAL_WORLD_STATE,
  rootReducer,
  runEconomy,
  seedGenesis,
  type WorldState,
} from "../vouch-world/src/environment";
import { replayState, stableStringify, type World } from "../vouch-world/src/foundation";
import { defineRegion, makeInstitutions } from "../vouch-world/src/region";

const TICKS = 12;
// A fixed notary seed — the gate is fully deterministic (no wall-clock, no Math.random).
const NOTARY = keyPairFromSeed(new Uint8Array(32).fill(7));

/** Build a world and drive the real economy. Pure function of `seed`. */
function buildAndRun(seed: string): World<WorldState> {
  const world = createAlmaWorld(seed);
  seedGenesis(world, [
    defineRegion("umi", "Umi", makeInstitutions({ verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false } })),
  ]);
  admitTreasury(world, "umi");
  for (const name of ["alice", "bob", "carol", "dan"]) {
    admitAgent(world, { id: `${name}@umi`, region: "umi", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 100 });
  }
  runEconomy(world, TICKS, { notary: NOTARY, criticalMass: 99 });
  return world;
}

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
}

console.log("determinism + replay-equivalence gate (real world composition)\n");

// (a) Determinism — same seed twice => byte-identical history.
const a = buildAndRun("determinism-gate");
const b = buildAndRun("determinism-gate");
check("same seed => identical log digest", a.log.digest() === b.log.digest());
check("same seed => identical log length", a.log.length === b.log.length);
check("same seed => identical full event log", stableStringify(a.log.all()) === stableStringify(b.log.all()));

// Sanity: a different seed must diverge, so the digest actually discriminates.
const c = buildAndRun("a-different-seed");
check("different seed => different digest", a.log.digest() !== c.log.digest());

// (b) Replay-equivalence — the log alone reconstructs the live state.
const rebuilt = replayState(a.log.all(), INITIAL_WORLD_STATE, rootReducer);
check("replayState(log) deep-equals live getState()", stableStringify(rebuilt.state) === stableStringify(a.getState()));
check("replayState tick equals live tick", rebuilt.tick === a.tick);

console.log(`\nlog: ${a.log.length} events, digest ${a.log.digest()}`);
if (failures > 0) {
  console.error(`\n✗ ${failures} determinism/replay check(s) FAILED`);
  process.exit(1);
}
console.log("\n✓ all determinism + replay-equivalence checks passed");
