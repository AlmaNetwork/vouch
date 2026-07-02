// A full end-to-end TOUR of the world — runs the whole Track A feature set and prints what
// happens, so you can see it actually work (not just pass tests). Run: `bun examples/world-tour.ts`

import { keyPairFromSeed } from "vouch-core";
import { currencySupply, getAgent, listAgents } from "../src/agent";
import {
  admitAgent,
  admitTreasury,
  amendInstitution,
  assertCurrencyConserved,
  createAlmaWorld,
  currencyOriginTotal,
  executeTransfer,
  experimenterProposal,
  listRegion,
  mintCurrency,
  proposeFounding,
  recognizeRegion,
  runEconomy,
  seedGenesis,
  setRegionLifecycle,
  transferRegionOwnership,
  vouchFor,
} from "../src/environment";
import { metrics } from "../src/observation";
import { defineRegion, listRegions, makeInstitutions } from "../src/region";

const notary = keyPairFromSeed(new Uint8Array(32).fill(7));
const lenient = () =>
  makeInstitutions({
    verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false },
    diplomacyPolicy: { defaultStance: "absorb", overrides: {} },
  });
const log = (s: string) => console.log(s);

const world = createAlmaWorld("world-tour");

log("\n=== 1. genesis: the established society ===");
seedGenesis(world, [defineRegion("umi", "Umi (genesis)", lenient())]);
admitTreasury(world, "umi");
log("seeded 'umi' (born recognized, system-owned)");

log("\n=== 2. a human founds & governs their own region ===");
proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", lenient()), "founded by alice", "acct:alice"));
admitTreasury(world, "nova");
for (const name of ["ann", "bo", "cy"])
  admitAgent(world, { id: `${name}@nova`, region: "nova", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 100 });
log("'nova' founded by acct:alice (unrecognized), 3 residents admitted @100 currency each");

log("\n=== 3. the economy runs (brains trade; fees -> treasury) ===");
runEconomy(world, 5, { notary, criticalMass: 99 });
log(`after 5 ticks: nova treasury = ${getAgent(world.getState(), "treasury@nova")?.balances.currency} (collected fees)`);
log(
  `ann credit/reputation = ${getAgent(world.getState(), "ann@nova")?.balances.credit}/${getAgent(world.getState(), "ann@nova")?.reputation}`,
);

log("\n=== 4. vouch: ann vouches for bo (the brand verb -> trust) ===");
vouchFor(world, "ann@nova", "bo@nova", 3);
vouchFor(world, "cy@nova", "bo@nova", 2);
log(
  `bo trust = ${getAgent(world.getState(), "bo@nova")?.trust} (distinct from reputation ${getAgent(world.getState(), "bo@nova")?.reputation})`,
);

log("\n=== 5. mint: explicit, logged currency origin ===");
mintCurrency(world, "bo@nova", 50, "founder-grant");
log(`bo currency after +50 mint = ${getAgent(world.getState(), "bo@nova")?.balances.currency}`);

log("\n=== 6. governance: the owner amends nova's economy + opens a council ===");
amendInstitution(
  world,
  "nova",
  { policy: "economy", value: { baseCostRate: 0.1, minCostRate: 0.05, repDiscount: 0.02, creditPerTx: 1 } },
  "acct:alice",
);
amendInstitution(
  world,
  "nova",
  { policy: "governance", value: { kind: "council", members: ["acct:alice", "acct:dave"], threshold: 1 } },
  "acct:alice",
);
log(`nova governance = ${JSON.stringify(listRegions(world.getState()).find((r) => r.id === "nova")?.institutions.governance)}`);

log("\n=== 7. diplomacy: umi recognizes nova, then a cross-border transfer ===");
recognizeRegion(world, "umi", "nova");
admitAgent(world, { id: "zoe@umi", region: "umi", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 0 });
const xb = executeTransfer(world, { from: "ann@nova", to: "zoe@umi", amount: 20 }, { tick: world.tick, notary });
log(
  `cross-border ann@nova -> zoe@umi: ${xb.ok ? `ok (fee ${xb.fee})` : `refused (${xb.reason})`}; zoe now has ${getAgent(world.getState(), "zoe@umi")?.balances.currency}`,
);

log("\n=== 8. market: hibernate -> list -> SELL nova (instance control; never deleted) ===");
setRegionLifecycle(world, "nova", "dormant", "acct:alice");
listRegion(world, "nova", 500, "acct:alice");
const sale = transferRegionOwnership(world, "nova", "acct:bob", "acct:alice");
const nova = listRegions(world.getState()).find((r) => r.id === "nova");
log(
  `sold: ${sale.ok}; nova owner=${nova?.owner} lifecycle=${nova?.lifecycle} governance=${nova?.institutions.governance.kind} (reset to new owner); residents still here: ${listAgents(world.getState()).filter((a) => a.region === "nova").length}`,
);

log("\n=== 9. conservation holds + observation snapshot ===");
assertCurrencyConserved(world);
log(`conservation OK: supply ${currencySupply(world.getState())} == origin(admitted+minted) ${currencyOriginTotal(world.log.all())}`);
const m = metrics(world);
log(
  `metrics: tick=${m.tick} regions=${m.regions.total}(rec ${m.regions.recognized}) residents=${m.agents.residents} totalCurrency=${m.agents.totalCurrency} gini=${m.agents.currencyGini.toFixed(3)} logLen=${m.log.length} digest=${m.log.digest}`,
);

log("\n=== final regions ===");
for (const r of listRegions(world.getState())) {
  log(`  ${r.id}: owner=${r.owner ?? "system"} status=${r.status} lifecycle=${r.lifecycle} gov=${r.institutions.governance.kind}`);
}
log("");
