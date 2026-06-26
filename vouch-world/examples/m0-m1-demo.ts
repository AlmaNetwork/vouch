// What M0 (Trust Core) + M1 (deterministic world engine) can do TOGETHER — today.
// No villages, no economy, no agents yet (those are M2/M3/M4). Run: `bun examples/m0-m1-demo.ts`

import { type Certificate, generateKeyPair, issueCertificate, keyPairFromSeed, verifyCertificate } from "vouch-core";
import { type AlmaEvent, type Reducer, World, replayState } from "../src/foundation";

// Map a tick to a deterministic timestamp (no wall clock -> stays reproducible, §2-7).
const EPOCH = Date.UTC(2026, 0, 1);
const tickToIso = (tick: number) => new Date(EPOCH + tick * 86_400_000).toISOString();

// A tiny domain: a ledger of which credentials were issued, at which tick.
interface Ledger {
  readonly credentials: ReadonlyArray<{ issuer: string; subject: string; schemaId: string; tick: number }>;
}
const INITIAL: Ledger = { credentials: [] };
const reducer: Reducer<Ledger> = (state, event: AlmaEvent) => {
  if (event.type === "credential.issued") {
    const c = event.payload.cert as Certificate;
    return { credentials: [...state.credentials, { issuer: c.issuer, subject: c.subject, schemaId: c.schemaId, tick: event.tick }] };
  }
  return state;
};

function runWorld(seed: string) {
  const world = new World<Ledger>({ seed, initialState: INITIAL, reducer });

  // M0 x M1: identities derived from the world RNG -> same seed yields the same keys.
  const guild = keyPairFromSeed(world.rng.bytes(32));

  // M1 tick loop; at tick 2 the guild issues a signed credential and records it as an event.
  world.run(3, (ctx) => {
    if (ctx.tick === 2) {
      const cert = issueCertificate(
        {
          issuer: "guild@umi",
          subject: "alice@umi",
          schemaId: "alma.trust/artisan/v1",
          claims: { role: "artisan", grade: 2 },
          issuedAt: tickToIso(ctx.tick), // time comes from the tick, not Date.now()
        },
        guild.privateKey,
      );
      ctx.emit("credential.issued", "guild@umi", { cert });
    }
  });

  return { world, guild };
}

const { world, guild } = runWorld("alma-demo");
const cert = world.log.all().find((e) => e.type === "credential.issued")!.payload.cert as Certificate;

console.log("1) world ran to tick:", world.tick);
console.log("   ledger (derived from the log):", JSON.stringify(world.getState()));
console.log("   event log length:", world.log.length, "(3 system.tick + 1 credential.issued)");
console.log();
console.log("2) M0 formal verify of the recorded credential:");
console.log("   valid issuer key   ->", verifyCertificate(cert, guild.publicKey));
console.log("   tampered claims     ->", verifyCertificate({ ...cert, claims: { role: "merchant" } }, guild.publicKey));
console.log("   wrong public key    ->", verifyCertificate(cert, generateKeyPair().publicKey));
console.log();
const rebuilt = replayState(world.log.all(), INITIAL, reducer);
console.log("3) M1 replay rebuilds the exact state from the log alone:");
console.log("   replay == live     ->", JSON.stringify(rebuilt.state) === JSON.stringify(world.getState()));
console.log();
console.log("4) determinism — same seed => identical history, different seed => different:");
console.log("   same seed digest    ->", runWorld("s").world.log.digest() === runWorld("s").world.log.digest());
console.log("   diff seed differs   ->", runWorld("a").world.log.digest() !== runWorld("b").world.log.digest());
