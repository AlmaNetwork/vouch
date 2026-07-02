import { describe, expect, test } from "bun:test";
import { type Certificate, encodeBase64, keyPairFromSeed, verifyCertificate } from "vouch-core";
import {
  currencySupply,
  EVENT_AGENT_DECIDED,
  EVENT_AGENT_VOUCHED,
  EVENT_ECONOMY_MINTED,
  EVENT_ECONOMY_SETTLED,
  getAgent,
  listAgents,
  treasuryId,
} from "../../src/agent";
import {
  admitAgent,
  admitTreasury,
  amendInstitution,
  assertCurrencyConserved,
  createAlmaWorld,
  currencyOriginTotal,
  detectEmergence,
  drawResource,
  executeTransfer,
  experimenterProposal,
  INITIAL_WORLD_STATE,
  immigrate,
  isCurrencyConserving,
  isTransferable,
  listRegion,
  mintCurrency,
  proposeFounding,
  regenerateResources,
  rootReducer,
  runEconomy,
  seedGenesis,
  setRegionLifecycle,
  transferRegionOwnership,
  vouchFor,
} from "../../src/environment";
import { replayState, SYSTEM_ACTOR } from "../../src/foundation";
import { defineRegion, getRegion, makeInstitutions, ownedRegionsOf, regionsForSale } from "../../src/region";

const NOTARY = keyPairFromSeed(new Uint8Array(32).fill(9));
const pub = (n: number) => encodeBase64(keyPairFromSeed(new Uint8Array(32).fill(n)).publicKey);

const lenient = () =>
  makeInstitutions({
    verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false },
    diplomacyPolicy: { defaultStance: "absorb", overrides: {} },
  });
const strict = () =>
  makeInstitutions({
    verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: true },
    diplomacyPolicy: { defaultStance: "reexamine", overrides: {} },
  });

function umiWorld(seed = "m3") {
  const world = createAlmaWorld(seed);
  seedGenesis(world, [defineRegion("umi", "Umi", lenient())]);
  admitTreasury(world, "umi");
  admitAgent(world, { id: "alice@umi", region: "umi", role: "merchant", valueProfile: "lenient", publicKey: pub(1), currency: 100 });
  admitAgent(world, { id: "bob@umi", region: "umi", role: "artisan", valueProfile: "lenient", publicKey: pub(2), currency: 0 });
  return world;
}

const totalCurrency = (state: { agents: Record<string, { balances: { currency: number } }> }) =>
  Object.values(state.agents).reduce((s, a) => s + a.balances.currency, 0);

describe("M3 — transactions go through the environment (§2-4/§2-5)", () => {
  test("a transfer settles, currency moves, and is conserved", () => {
    const world = umiWorld();
    const supplyBefore = totalCurrency(world.getState());

    const res = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 40 }, { tick: 0, notary: NOTARY });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fee).toBe(8); // floor(40 * 0.2) at reputation 0

    const s = world.getState();
    expect(getAgent(s, "alice@umi")?.balances.currency).toBe(60);
    expect(getAgent(s, "bob@umi")?.balances.currency).toBe(32); // 40 - fee 8
    expect(getAgent(s, treasuryId("umi"))?.balances.currency).toBe(8);
    expect(totalCurrency(s)).toBe(supplyBefore); // conservation

    // credit accrues (non-transferable trust), reputation rises
    expect(getAgent(s, "alice@umi")?.balances.credit).toBe(1);
    expect(getAgent(s, "alice@umi")?.reputation).toBe(1);

    // recorded as one env-authored settlement event
    const settled = world.log.all().filter((e) => e.type === EVENT_ECONOMY_SETTLED);
    expect(settled.length).toBe(1);
    expect(settled[0]?.actor).toBe("world");
  });

  test("the byproduct receipt certificate verifies and accumulates in the log", () => {
    const world = umiWorld();
    executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 0, notary: NOTARY });
    executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 1, notary: NOTARY });

    const settled = world.log.all().filter((e) => e.type === EVENT_ECONOMY_SETTLED);
    expect(settled.length).toBe(2);
    for (const e of settled) {
      const receipt = (e.payload as { receipt: Certificate }).receipt;
      expect(verifyCertificate(receipt, NOTARY.publicKey)).toEqual({ ok: true });
      expect(receipt.schemaId).toBe("alma.tx/receipt/v1");
      // the receipt records WHICH notary key signed it (multi-node verification, no key directory)
      expect(receipt.claims.notaryKeyId).toBe(encodeBase64(NOTARY.publicKey));
    }
  });

  test("isCurrencyConserving is a pure check on the entries", () => {
    expect(
      isCurrencyConserving([
        { agentId: "a", currencyDelta: -5, creditDelta: 0, reputationDelta: 0 },
        { agentId: "b", currencyDelta: 5, creditDelta: 0, reputationDelta: 0 },
      ]),
    ).toBe(true);
    expect(isCurrencyConserving([{ agentId: "a", currencyDelta: -5, creditDelta: 0, reputationDelta: 0 }])).toBe(false);
  });
});

describe("M3 — only the environment can change value (§2-4, audit G8)", () => {
  test("a self-asserted balance event is ignored by the reducer", () => {
    const world = umiWorld();
    const before = getAgent(world.getState(), "alice@umi")?.balances.currency;

    // An agent forges a settlement with its OWN actor — the fold point rejects it.
    world.emit(EVENT_ECONOMY_SETTLED, "alice@umi", {
      entries: [{ agentId: "alice@umi", currencyDelta: 1000, creditDelta: 0, reputationDelta: 0 }],
      memo: { from: "alice@umi", to: "alice@umi", amount: 0, fee: 0 },
    });

    expect(getAgent(world.getState(), "alice@umi")?.balances.currency).toBe(before);
  });

  test("a SYSTEM_ACTOR settlement cannot be forged via emit — blocked at write time (audit G7)", () => {
    const world = umiWorld();
    const before = getAgent(world.getState(), "alice@umi")?.balances.currency;

    // Forging the env actor ("world") on a value event now THROWS — it never enters the log.
    expect(() =>
      world.emit(EVENT_ECONOMY_SETTLED, SYSTEM_ACTOR, {
        entries: [{ agentId: "alice@umi", currencyDelta: 1000, creditDelta: 0, reputationDelta: 0 }],
        memo: { from: "alice@umi", to: "alice@umi", amount: 0, fee: 0 },
      }),
    ).toThrow();

    expect(getAgent(world.getState(), "alice@umi")?.balances.currency).toBe(before);
    expect(world.log.all().some((e) => e.type === EVENT_ECONOMY_SETTLED)).toBe(false);
  });

  test("a cross-region transfer to an unrecognized region is refused (M4 diplomacy gate)", () => {
    const world = umiWorld();
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", lenient())));
    admitTreasury(world, "nova");
    admitAgent(world, { id: "carol@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: pub(3), currency: 50 });

    const res = executeTransfer(world, { from: "alice@umi", to: "carol@nova", amount: 10 }, { tick: 0, notary: NOTARY });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("receiver-region-unrecognized");
  });

  test("a transfer with no treasury is rejected, so the fee can't leak (no-treasury)", () => {
    // region + two FUNDED agents but NO treasury => the fee sink is missing.
    const world = createAlmaWorld("notreasury");
    seedGenesis(world, [defineRegion("umi", "Umi", lenient())]);
    admitAgent(world, { id: "alice@umi", region: "umi", role: "merchant", valueProfile: "lenient", publicKey: pub(1), currency: 100 });
    admitAgent(world, { id: "bob@umi", region: "umi", role: "artisan", valueProfile: "lenient", publicKey: pub(2), currency: 0 });
    const supply = totalCurrency(world.getState());

    const res = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 40 }, { tick: 0, notary: NOTARY });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-treasury");
    expect(totalCurrency(world.getState())).toBe(supply); // nothing moved, nothing leaked
    expect(world.log.all().some((e) => e.type === EVENT_ECONOMY_SETTLED)).toBe(false);
  });

  test("an overdraw is rejected (insufficient-funds); no negative balances", () => {
    const world = umiWorld(); // bob has currency 0
    const res = executeTransfer(world, { from: "bob@umi", to: "alice@umi", amount: 50 }, { tick: 0, notary: NOTARY });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("insufficient-funds");
    expect(getAgent(world.getState(), "bob@umi")?.balances.currency).toBe(0);
    expect(getAgent(world.getState(), "alice@umi")?.balances.currency).toBe(100);
    expect(world.log.all().some((e) => e.type === EVENT_ECONOMY_SETTLED)).toBe(false);
  });

  test("currency is transferable, credit is not (§3-B)", () => {
    expect(isTransferable("currency")).toBe(true);
    expect(isTransferable("credit")).toBe(false);
  });
});

describe("Track A — explicit mint + auditable supply (conservation baseline)", () => {
  test("mintCurrency is the explicit, logged origin of currency; supply grows by exactly the amount", () => {
    const world = umiWorld(); // alice 100, bob 0, treasury 0 => supply 100
    const before = currencySupply(world.getState());
    expect(before).toBe(100);

    const res = mintCurrency(world, "bob@umi", 50, "genesis-grant");
    expect(res.ok).toBe(true);
    expect(getAgent(world.getState(), "bob@umi")?.balances.currency).toBe(50);
    expect(currencySupply(world.getState())).toBe(before + 50);

    // a logged, env-authored event (actor "world")
    const minted = world.log.all().filter((e) => e.type === EVENT_ECONOMY_MINTED);
    expect(minted.length).toBe(1);
    expect(minted[0]?.actor).toBe("world");

    // replay reproduces the minted supply exactly
    expect(replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(world.getState());
  });

  test("a forged mint can't enter the log (write-time) nor be honored unauthored (reducer-gate)", () => {
    const world = umiWorld();
    const before = currencySupply(world.getState());
    // forging the env actor on a mint throws at write time
    expect(() => world.emit(EVENT_ECONOMY_MINTED, SYSTEM_ACTOR, { agentId: "alice@umi", amount: 999, reason: "x" })).toThrow();
    // a self-asserted (non-system) mint is ignored by the reducer's actor-gate
    world.emit(EVENT_ECONOMY_MINTED, "alice@umi", { agentId: "alice@umi", amount: 999, reason: "x" });
    expect(currencySupply(world.getState())).toBe(before);
  });

  test("transfers conserve supply; only admission + mint change it", () => {
    const world = umiWorld();
    const supply = currencySupply(world.getState());
    executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 40 }, { tick: 0, notary: NOTARY });
    expect(currencySupply(world.getState())).toBe(supply); // a transfer is zero-sum
    mintCurrency(world, "bob@umi", 10, "grant");
    expect(currencySupply(world.getState())).toBe(supply + 10);
  });
});

describe("Track A P3 — scarcity / resource competition (the 'compete' substrate)", () => {
  test("a finite pool regenerates per tick; residents compete to draw; conserved pool<->agent", () => {
    const world = createAlmaWorld("scarcity");
    // a region with a finite pool: holds 2, produces +2/tick
    const scarce = makeInstitutions({
      resourcePolicy: { capacity: 2, regenPerTick: 2 },
      verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false },
      diplomacyPolicy: { defaultStance: "absorb", overrides: {} },
    });
    seedGenesis(world, [defineRegion("umi", "Umi", scarce)]);
    admitTreasury(world, "umi");
    for (const n of ["a", "b", "c"])
      admitAgent(world, { id: `${n}@umi`, region: "umi", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 0 });

    // the pool produces up to capacity, then caps (no overfill)
    regenerateResources(world, "umi");
    expect(getRegion(world.getState(), "umi")?.resourceLevel).toBe(2);
    regenerateResources(world, "umi");
    expect(getRegion(world.getState(), "umi")?.resourceLevel).toBe(2);

    // three residents compete for 2 units: the first two win, the third is STARVED (scarcity)
    expect(drawResource(world, "a@umi", 1).ok).toBe(true);
    expect(drawResource(world, "b@umi", 1).ok).toBe(true);
    const c = drawResource(world, "c@umi", 1);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe("insufficient-resource");

    // a draw is conserved pool<->agent: pool 0; a & b hold 1 each; c holds 0
    expect(getRegion(world.getState(), "umi")?.resourceLevel).toBe(0);
    expect(getAgent(world.getState(), "a@umi")?.resources).toBe(1);
    expect(getAgent(world.getState(), "b@umi")?.resources).toBe(1);
    expect(getAgent(world.getState(), "c@umi")?.resources).toBe(0);

    // bad draw amounts are rejected
    expect(drawResource(world, "a@umi", 0).ok).toBe(false);

    // the whole thing replays exactly
    expect(replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(world.getState());
  });

  test("regions with no pool (default policy) produce nothing — no resource events", () => {
    const world = createAlmaWorld("nopool");
    seedGenesis(world, [defineRegion("umi", "Umi", lenient())]); // default resourcePolicy {0,0}
    regenerateResources(world, "umi");
    expect(getRegion(world.getState(), "umi")?.resourceLevel).toBe(0);
    expect(world.log.all().some((e) => e.type === "resource.regenerated")).toBe(false);
  });
});

describe("Track A P3 — region market: ownership transfers, region never deleted (instance control)", () => {
  test("hibernate -> list -> transfer; owner-gated; residents + treasury PRESERVED; replays", () => {
    const world = createAlmaWorld("market");
    seedGenesis(world, [defineRegion("umi", "Umi", lenient())]);
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", lenient()), undefined, "acct:alice"));
    admitTreasury(world, "nova");
    admitAgent(world, { id: "r@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: pub(1), currency: 50 });

    // a non-owner cannot manage the instance; can't list while active
    expect(setRegionLifecycle(world, "nova", "dormant", "acct:mallory").ok).toBe(false);
    expect(listRegion(world, "nova", 100, "acct:alice").ok).toBe(false); // not-dormant

    // owner hibernates, then lists
    expect(setRegionLifecycle(world, "nova", "dormant", "acct:alice").ok).toBe(true);
    expect(getRegion(world.getState(), "nova")?.lifecycle).toBe("dormant");
    expect(listRegion(world, "nova", 100, "acct:alice").ok).toBe(true);
    expect(getRegion(world.getState(), "nova")?.salePrice).toBe(100);
    expect(regionsForSale(world.getState()).map((r) => r.id)).toEqual(["nova"]);

    // can't transfer by a non-owner; owner sells/hands over to bob
    expect(transferRegionOwnership(world, "nova", "acct:bob", "acct:mallory").ok).toBe(false);
    expect(transferRegionOwnership(world, "nova", "acct:bob", "acct:alice").ok).toBe(true);

    const nova = getRegion(world.getState(), "nova");
    expect(nova?.owner).toBe("acct:bob"); // ownership moved
    expect(nova?.lifecycle).toBe("active"); // reactivated
    expect(nova?.salePrice).toBeNull(); // delisted

    // the region is PRESERVED — residents + treasury survive with balances intact, never deleted
    expect(getAgent(world.getState(), "r@nova")?.balances.currency).toBe(50);
    expect(getAgent(world.getState(), treasuryId("nova"))).toBeDefined();
    expect(getRegion(world.getState(), "nova")).toBeDefined();

    // alice no longer owns it; bob does (an ID may own 0..N regions)
    expect(ownedRegionsOf(world.getState(), "acct:alice").map((r) => r.id)).toEqual([]);
    expect(ownedRegionsOf(world.getState(), "acct:bob").map((r) => r.id)).toEqual(["nova"]);

    // can't transfer an unlisted region
    expect(transferRegionOwnership(world, "nova", "acct:carol", "acct:bob").ok).toBe(false); // not-listed

    expect(replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(world.getState());
  });

  test("selling a COUNCIL-governed region resets governance to the buyer (seller loses amend rights)", () => {
    const world = createAlmaWorld("councilsale");
    seedGenesis(world, [defineRegion("umi", "Umi", lenient())]);
    const council = makeInstitutions({
      governance: { kind: "council", members: ["acct:alice", "acct:dave"], threshold: 1 },
      verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false },
      diplomacyPolicy: { defaultStance: "absorb", overrides: {} },
    });
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", council), undefined, "acct:alice"));
    setRegionLifecycle(world, "nova", "dormant", "acct:alice");
    listRegion(world, "nova", 100, "acct:alice");
    expect(transferRegionOwnership(world, "nova", "acct:carol", "acct:alice").ok).toBe(true);

    // governance RESET to dictatorship under the new owner; the seller's stale council seat is gone
    expect(getRegion(world.getState(), "nova")?.institutions.governance.kind).toBe("dictatorship");
    expect(getRegion(world.getState(), "nova")?.owner).toBe("acct:carol");
    // the buyer can amend; the seller (former council member) cannot
    amendInstitution(world, "nova", { policy: "diplomacy", value: { defaultStance: "reject", overrides: {} } }, "acct:carol");
    expect(() =>
      amendInstitution(world, "nova", { policy: "diplomacy", value: { defaultStance: "absorb", overrides: {} } }, "acct:alice"),
    ).toThrow();
  });

  test("a DORMANT region's economy is frozen — residents cannot initiate transfers", () => {
    const world = createAlmaWorld("frozen");
    seedGenesis(world, [defineRegion("umi", "Umi", lenient())]);
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", lenient()), undefined, "acct:alice"));
    admitTreasury(world, "nova");
    admitAgent(world, { id: "x@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: pub(1), currency: 50 });
    admitAgent(world, { id: "y@nova", region: "nova", role: "artisan", valueProfile: "lenient", publicKey: pub(2), currency: 0 });

    expect(executeTransfer(world, { from: "x@nova", to: "y@nova", amount: 10 }, { tick: 0, notary: NOTARY }).ok).toBe(true);
    setRegionLifecycle(world, "nova", "dormant", "acct:alice"); // hibernate
    const r = executeTransfer(world, { from: "x@nova", to: "y@nova", amount: 10 }, { tick: 1, notary: NOTARY });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("region-dormant");
  });
});

describe("Track A — conservation runtime assertion (supply == logged origin)", () => {
  test("supply equals admitted + minted; transfers are zero-sum; forged origins don't count", () => {
    const world = umiWorld(); // alice 100, bob 0, treasury 0 => origin 100
    expect(currencyOriginTotal(world.log.all())).toBe(100);
    expect(currencySupply(world.getState())).toBe(100);
    assertCurrencyConserved(world); // no throw

    // a transfer is zero-sum — supply and origin both unchanged
    executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 40 }, { tick: 0, notary: NOTARY });
    expect(currencySupply(world.getState())).toBe(100);
    assertCurrencyConserved(world);

    // an explicit mint moves supply AND origin together (stays conserved)
    mintCurrency(world, "bob@umi", 25, "grant");
    expect(currencySupply(world.getState())).toBe(125);
    expect(currencyOriginTotal(world.log.all())).toBe(125);
    assertCurrencyConserved(world);

    // a FORGED (non-system) mint changes neither supply nor origin — they stay in lockstep
    world.emit(EVENT_ECONOMY_MINTED, "acct:mallory", { agentId: "bob@umi", amount: 999, reason: "x" });
    expect(currencySupply(world.getState())).toBe(125);
    expect(currencyOriginTotal(world.log.all())).toBe(125);
    assertCurrencyConserved(world);
  });
});

describe("Track A — region-configurable fee policy (sovereignty over the economy)", () => {
  test("a region sets its own fee schedule and its owner can amend it", () => {
    const world = createAlmaWorld("feepolicy");
    seedGenesis(world, [defineRegion("umi", "Umi", lenient())]);
    // an owner founds a region with a steep 50% fee policy
    const steep = makeInstitutions({
      economyPolicy: { baseCostRate: 0.5, minCostRate: 0.1, repDiscount: 0, creditPerTx: 1 },
      verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false },
      diplomacyPolicy: { defaultStance: "absorb", overrides: {} },
    });
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", steep), undefined, "acct:alice"));
    admitTreasury(world, "nova");
    admitAgent(world, { id: "a@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: pub(1), currency: 100 });
    admitAgent(world, { id: "b@nova", region: "nova", role: "artisan", valueProfile: "lenient", publicKey: pub(2), currency: 0 });

    // the region's own steep policy applies
    const r1 = executeTransfer(world, { from: "a@nova", to: "b@nova", amount: 40 }, { tick: 0, notary: NOTARY });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.fee).toBe(20); // floor(40 * 0.5)

    // the owner amends to a cheaper policy (owner-scoped)
    amendInstitution(
      world,
      "nova",
      { policy: "economy", value: { baseCostRate: 0.1, minCostRate: 0.05, repDiscount: 0, creditPerTx: 1 } },
      "acct:alice",
    );
    const r2 = executeTransfer(world, { from: "a@nova", to: "b@nova", amount: 40 }, { tick: 1, notary: NOTARY });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.fee).toBe(4); // floor(40 * 0.1)

    // a non-owner cannot change the economy policy
    expect(() =>
      amendInstitution(
        world,
        "nova",
        { policy: "economy", value: { baseCostRate: 0, minCostRate: 0, repDiscount: 0, creditPerTx: 1 } },
        "acct:mallory",
      ),
    ).toThrow();
  });

  test("a degenerate fee policy is rejected (no fee>amount, negative rate, min>base, or bad credit)", () => {
    // rejected at construction (rates must be in [0,1], min<=base, creditPerTx a non-negative int)
    expect(() => makeInstitutions({ economyPolicy: { baseCostRate: 1.5, minCostRate: 0.5, repDiscount: 0, creditPerTx: 1 } })).toThrow();
    expect(() => makeInstitutions({ economyPolicy: { baseCostRate: -0.5, minCostRate: -0.5, repDiscount: 0, creditPerTx: 1 } })).toThrow();
    expect(() => makeInstitutions({ economyPolicy: { baseCostRate: 0.2, minCostRate: 0.5, repDiscount: 0, creditPerTx: 1 } })).toThrow(); // min > base
    expect(() => makeInstitutions({ economyPolicy: { baseCostRate: 0.2, minCostRate: 0.05, repDiscount: 0, creditPerTx: -1 } })).toThrow();

    // and rejected at AMEND time — an owner can't drive the recipient negative via a fee > amount
    const world = createAlmaWorld("badfee");
    seedGenesis(world, [defineRegion("umi", "Umi", lenient())]);
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", makeInstitutions()), undefined, "acct:alice"));
    expect(() =>
      amendInstitution(
        world,
        "nova",
        { policy: "economy", value: { baseCostRate: 1.5, minCostRate: 1.5, repDiscount: 0, creditPerTx: 1 } },
        "acct:alice",
      ),
    ).toThrow();
  });
});

describe("Track A — vouch -> trust (the brand verb)", () => {
  test("vouching raises the subject's trust (distinct from reputation); bad inputs + forge rejected", () => {
    const world = umiWorld(); // alice, bob in umi; trust starts 0
    expect(getAgent(world.getState(), "bob@umi")?.trust).toBe(0);

    expect(vouchFor(world, "alice@umi", "bob@umi", 3).ok).toBe(true);
    expect(getAgent(world.getState(), "bob@umi")?.trust).toBe(3);
    vouchFor(world, "alice@umi", "bob@umi", 2); // accumulates
    expect(getAgent(world.getState(), "bob@umi")?.trust).toBe(5);
    // trust is DISTINCT from economy reputation — a vouch doesn't touch reputation/fees
    expect(getAgent(world.getState(), "bob@umi")?.reputation).toBe(0);

    // user-level failures return a reason, change nothing
    expect(vouchFor(world, "alice@umi", "alice@umi", 1).ok).toBe(false); // self-vouch
    expect(vouchFor(world, "alice@umi", "bob@umi", 9).ok).toBe(false); // weight out of range
    expect(vouchFor(world, "ghost@umi", "bob@umi", 1).ok).toBe(false); // unknown agent

    // a forged (non-system) vouch is ignored by the reducer's actor-gate
    world.emit(EVENT_AGENT_VOUCHED, "acct:mallory", { from: "acct:mallory", to: "bob@umi", weight: 5 });
    expect(getAgent(world.getState(), "bob@umi")?.trust).toBe(5);

    expect(replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(world.getState());
  });
});

describe("M3 — immigration (§3-C)", () => {
  test("an agent can immigrate to a founded (unrecognized) region", () => {
    const world = umiWorld();
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", lenient())));

    expect(getAgent(world.getState(), "alice@umi")?.region).toBe("umi");
    immigrate(world, "alice@umi", "nova");
    expect(getAgent(world.getState(), "alice@umi")?.region).toBe("nova");
  });

  test("a migrated agent then trades in its NEW region (fee routes to the new treasury)", () => {
    const world = umiWorld();
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", lenient())));
    admitTreasury(world, "nova");
    admitAgent(world, { id: "carol@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: pub(3), currency: 0 });
    immigrate(world, "alice@umi", "nova"); // alice now resides in nova

    const res = executeTransfer(world, { from: "alice@umi", to: "carol@nova", amount: 10 }, { tick: 0, notary: NOTARY });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(getAgent(world.getState(), treasuryId("nova"))?.balances.currency).toBe(res.fee);
    expect(getAgent(world.getState(), treasuryId("umi"))?.balances.currency).toBe(0); // old region untouched
  });
});

describe("M3 — internal emergence founding (§3-D, reuses the M2 engine)", () => {
  test("a dissatisfied cohort at critical mass secedes and founds a matching region", () => {
    const world = createAlmaWorld("emerge");
    seedGenesis(world, [defineRegion("yama", "Yama (strict)", strict())]);
    admitTreasury(world, "yama");
    // three agents whose value profile (lenient) clashes with the strict region
    for (let i = 1; i <= 3; i++) {
      admitAgent(world, {
        id: `a${i}@yama`,
        region: "yama",
        role: "merchant",
        valueProfile: "lenient",
        publicKey: pub(10 + i),
        currency: 20,
      });
    }

    detectEmergence(world, 3);

    const seceded = getRegion(world.getState(), "lenientyama");
    expect(seceded).toBeDefined();
    expect(seceded?.status).toBe("unrecognized");
    expect(seceded?.proposer.kind).toBe("emergence");
    // the dissatisfaction shaped the institutions: lenient cohort -> lenient region
    expect(seceded?.institutions.verificationPolicy.rejectUnknownSchemas).toBe(false);

    // the cohort migrated to the new region
    for (let i = 1; i <= 3; i++) {
      expect(getAgent(world.getState(), `a${i}@yama`)?.region).toBe("lenientyama");
    }

    // it ran through the SAME founding engine, recorded with the emergence proposer + cohort
    const founded = world.log
      .all()
      .find((e) => e.type === "region.founded" && (e.payload as { region: { id: string } }).region.id === "lenientyama");
    expect((founded?.payload as { proposer: { kind: string; cohort: string[] } }).proposer.cohort).toEqual([
      "a1@yama",
      "a2@yama",
      "a3@yama",
    ]);
  });

  test("a seceded region INHERITS the parent's schemaLedger + maps the parent's certs (emergence inheritance)", () => {
    const world = createAlmaWorld("inherit");
    const parent = makeInstitutions({
      schemaLedger: [{ schemaId: "alma.trust/artisan/v1", label: "artisan" }],
      verificationPolicy: { acceptedSchemaIds: ["alma.trust/artisan/v1"], rejectUnknownSchemas: true },
      diplomacyPolicy: { defaultStance: "reexamine", overrides: {} },
    });
    seedGenesis(world, [defineRegion("yama", "Yama (strict)", parent)]);
    admitTreasury(world, "yama");
    for (let i = 1; i <= 3; i++) {
      admitAgent(world, {
        id: `a${i}@yama`,
        region: "yama",
        role: "merchant",
        valueProfile: "lenient",
        publicKey: pub(10 + i),
        currency: 20,
      });
    }
    detectEmergence(world, 3);

    const seceded = getRegion(world.getState(), "lenientyama");
    expect(seceded).toBeDefined();
    // inherited the parent's certificate vocabulary...
    expect(seceded?.institutions.schemaLedger.map((e) => e.schemaId)).toEqual(["alma.trust/artisan/v1"]);
    // ...and translates the parent's certs into the local vocabulary (map)
    expect(seceded?.institutions.diplomacyPolicy.overrides.yama).toBe("map");
    // the cohort carried its balances across the secession
    expect(getAgent(world.getState(), "a1@yama")?.balances.currency).toBe(20);
    expect(getAgent(world.getState(), "a1@yama")?.region).toBe("lenientyama");
  });

  test("below critical mass, nothing secedes", () => {
    const world = createAlmaWorld("nomass");
    seedGenesis(world, [defineRegion("yama", "Yama", strict())]);
    admitTreasury(world, "yama");
    admitAgent(world, { id: "lonely@yama", region: "yama", role: "merchant", valueProfile: "lenient", publicKey: pub(20), currency: 20 });

    detectEmergence(world, 3);
    expect(getRegion(world.getState(), "lenientyama")).toBeUndefined();
  });

  test("a SECOND dissatisfied wave immigrates into the existing seceded region, not stranded (EMG-1)", () => {
    const world = createAlmaWorld("secondwave");
    seedGenesis(world, [defineRegion("yama", "Yama (strict)", strict())]);
    admitTreasury(world, "yama");
    for (let i = 1; i <= 3; i++) {
      admitAgent(world, {
        id: `a${i}@yama`,
        region: "yama",
        role: "merchant",
        valueProfile: "lenient",
        publicKey: pub(10 + i),
        currency: 20,
      });
    }
    const founded = () =>
      world.log.all().filter((e) => e.type === "region.founded" && (e.payload as { region: { id: string } }).region.id === "lenientyama")
        .length;

    detectEmergence(world, 3); // first wave: founds + migrates
    expect(founded()).toBe(1);

    // a later cohort of lenient agents appears in the still-strict region
    for (let i = 4; i <= 6; i++) {
      admitAgent(world, {
        id: `a${i}@yama`,
        region: "yama",
        role: "merchant",
        valueProfile: "lenient",
        publicKey: pub(10 + i),
        currency: 20,
      });
    }
    detectEmergence(world, 3); // second wave: must NOT re-found, but MUST migrate

    expect(founded()).toBe(1); // founded once, never twice
    for (let i = 4; i <= 6; i++) {
      expect(getAgent(world.getState(), `a${i}@yama`)?.region).toBe("lenientyama"); // not stranded
    }
  });
});

describe("M3 — determinism + replay survive the brain layer (§2-7, audit G6)", () => {
  function scenario(seed: string) {
    const world = createAlmaWorld(seed);
    seedGenesis(world, [defineRegion("umi", "Umi", lenient())]);
    admitTreasury(world, "umi");
    for (const [name, n] of [
      ["alice", 1],
      ["bob", 2],
      ["carol", 3],
      ["dave", 4],
    ] as const) {
      admitAgent(world, { id: `${name}@umi`, region: "umi", role: "merchant", valueProfile: "lenient", publicKey: pub(n), currency: 100 });
    }
    runEconomy(world, 6, { notary: NOTARY, criticalMass: 99 });
    return world;
  }

  test("same seed + same scenario => byte-identical history", () => {
    expect(scenario("rep").log.digest()).toBe(scenario("rep").log.digest());
    expect(scenario("a").log.digest()).not.toBe(scenario("b").log.digest());
  });

  test("brains drove real trades, journaled as agent.decided", () => {
    const world = scenario("trade");
    expect(world.log.all().some((e) => e.type === EVENT_AGENT_DECIDED)).toBe(true);
    expect(world.log.all().some((e) => e.type === EVENT_ECONOMY_SETTLED)).toBe(true);
  });

  test("replay rebuilds the exact world state from the log alone (brain never re-invoked)", () => {
    const world = scenario("replay");
    const rebuilt = replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer);
    expect(rebuilt.state).toEqual(world.getState());

    // currency is conserved across the whole run
    expect(totalCurrency(world.getState())).toBe(400);
    // every resident's reputation is non-negative and credit accrued where they traded
    expect(listAgents(world.getState()).every((a) => a.reputation >= 0 && a.balances.currency >= 0)).toBe(true);
  });

  function emergenceScenario(seed: string) {
    const world = createAlmaWorld(seed);
    seedGenesis(world, [defineRegion("yama", "Yama (strict)", strict())]);
    admitTreasury(world, "yama");
    for (let i = 1; i <= 4; i++) {
      admitAgent(world, {
        id: `a${i}@yama`,
        region: "yama",
        role: "merchant",
        valueProfile: "lenient",
        publicKey: pub(30 + i),
        currency: 100,
      });
    }
    runEconomy(world, 6, { notary: NOTARY, criticalMass: 3 }); // emergence FIRES during this run
    return world;
  }

  test("determinism + replay hold even on the emergence-active path", () => {
    expect(emergenceScenario("emg").log.digest()).toBe(emergenceScenario("emg").log.digest());

    const world = emergenceScenario("emg2");
    // guard against vacuity: emergence actually fired and the cohort moved
    expect(getRegion(world.getState(), "lenientyama")).toBeDefined();
    expect(getAgent(world.getState(), "a1@yama")?.region).toBe("lenientyama");
    // ...and the whole history (secession + mass migration included) still replays exactly
    expect(replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(world.getState());
  });
});
