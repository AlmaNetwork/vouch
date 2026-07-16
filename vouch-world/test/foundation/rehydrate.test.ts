import { describe, expect, test } from "bun:test";
import { keyPairFromSeed } from "vouch-core";
import { getAgent } from "../../src/agent";
import {
  admitAgent,
  admitTreasury,
  assertCurrencyConserved,
  createAlmaWorld,
  executeTransfer,
  experimenterProposal,
  mintCurrency,
  proposeFounding,
  rehydrateAlmaWorld,
  seedGenesis,
} from "../../src/environment";
import { World } from "../../src/foundation";
import { defineRegion } from "../../src/region";

/** Drive a world through a representative slice of the write surface. */
function buildWorld() {
  const notary = keyPairFromSeed(new Uint8Array(32).fill(7));
  const world = createAlmaWorld("rehydrate-seed");
  seedGenesis(world, [defineRegion("umi", "Umi")]);
  admitTreasury(world, "umi");
  proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova"), "founded by alice", "acct:alice"));
  admitTreasury(world, "nova");
  admitAgent(world, { id: "ann@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 100 });
  admitAgent(world, { id: "bo@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 100 });
  mintCurrency(world, "ann@nova", 50, "founder-grant");
  executeTransfer(world, { from: "ann@nova", to: "bo@nova", amount: 20 }, { tick: world.tick, notary });
  return world;
}

describe("rehydrateAlmaWorld (replay-on-boot durability)", () => {
  test("rebuilt world equals the original: same digest, tick, and state", () => {
    const original = buildWorld();
    const rebuilt = rehydrateAlmaWorld("rehydrate-seed", original.log.all());

    expect(rebuilt.log.length).toBe(original.log.length);
    expect(rebuilt.log.digest()).toBe(original.log.digest());
    expect(rebuilt.tick).toBe(original.tick);
    expect(JSON.stringify(rebuilt.getState())).toBe(JSON.stringify(original.getState()));
    // spot-check a folded balance survived the round-trip (sender pays exactly `amount`,
    // so ann = 100 start + 50 mint - 20 sent = 130, independent of the fee rate).
    expect(getAgent(rebuilt.getState(), "ann@nova")?.balances.currency).toBe(130);
    expect(() => assertCurrencyConserved(rebuilt)).not.toThrow();
  });

  test("an empty log rebuilds the initial world", () => {
    const rebuilt = rehydrateAlmaWorld("s", []);
    expect(rebuilt.tick).toBe(0);
    expect(rebuilt.log.length).toBe(0);
    expect(getAgent(rebuilt.getState(), "ann@nova")).toBeUndefined();
  });

  test("the rebuilt world keeps accepting writes and stays conserved", () => {
    const original = buildWorld();
    const notary = keyPairFromSeed(new Uint8Array(32).fill(7));
    const rebuilt = rehydrateAlmaWorld("rehydrate-seed", original.log.all());

    const before = getAgent(rebuilt.getState(), "ann@nova")?.balances.currency ?? 0;
    const move = executeTransfer(rebuilt, { from: "ann@nova", to: "bo@nova", amount: 10 }, { tick: rebuilt.tick, notary });
    expect(move.ok).toBe(true);
    // the sender pays exactly `amount` (the fee is taken out of it, to the treasury).
    expect(getAgent(rebuilt.getState(), "ann@nova")?.balances.currency).toBe(before - 10);
    expect(() => assertCurrencyConserved(rebuilt)).not.toThrow();
  });

  test("a journal seq gap is rejected (corruption is not silently absorbed)", () => {
    const good = buildWorld().log.all();
    const gappy = good.filter((e) => e.seq !== 2); // drop one event -> seq gap
    expect(() =>
      World.fromLog(
        { seed: "x", initialState: { regions: {}, agents: {}, items: {} }, reducer: () => ({ regions: {}, agents: {}, items: {} }) },
        gappy,
      ),
    ).toThrow(/seq gap/);
  });
});
