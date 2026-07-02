// Start the read-only observation server over a small running world.
// Run: `bun examples/observe.ts` then open http://localhost:8787/metrics
// External clients CONNECT here to WATCH — they cannot change the world (§2-6).

import { keyPairFromSeed } from "vouch-core";
import { admitAgent, admitTreasury, createAlmaWorld, runEconomy, seedGenesis } from "../src/environment";
import { serveObservation } from "../src/observation";
import { defineRegion, makeInstitutions } from "../src/region";

const world = createAlmaWorld("observe");
seedGenesis(world, [
  defineRegion("umi", "Umi", makeInstitutions({ verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false } })),
]);
admitTreasury(world, "umi");
for (const name of ["alice", "bob", "carol"]) {
  admitAgent(world, { id: `${name}@umi`, region: "umi", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 100 });
}
runEconomy(world, 8, { notary: keyPairFromSeed(new Uint8Array(32).fill(9)), criticalMass: 99 });

const { port } = serveObservation(world, { port: Number(process.env.PORT ?? 8787) });
console.log(`vouch observation (read-only) — http://localhost:${port}`);
console.log("  try: /metrics  /state  /regions  /agents  /log?since=0  /log/digest");
