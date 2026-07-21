// RFC 0007 §9 — sanction primitives: suspendId / reinstateId
//
// Property invariants verified here:
//   K1: suspension blocks executeTransfer
//   K2: suspension does NOT block emigration (Tier K-5)
//   K3: reinstateAgent lifts suspension early
//   K4: suspension auto-expires when tick > untilTick
//   K5: conservation — currency unchanged by a sanction event
//   K6: actor-gate — forged agent.suspended (non-SYSTEM_ACTOR) is ignored by the reducer
//   K7: replay determinism — replayState(log) == live state after sanctions
//   K8: computeStanding returns correct standing
//   K9: sponsor list stored at admission

import { describe, expect, test } from "bun:test";
import { encodeBase64, keyPairFromSeed } from "vouch-core";
import {
  computeStanding,
  currencySupply,
  EVENT_AGENT_SUSPENDED,
  getAgent,
  isAgentSuspended,
} from "../../src/agent";
import {
  admitAgent,
  admitTreasury,
  createAlmaWorld,
  executeTransfer,
  INITIAL_WORLD_STATE,
  immigrate,
  reinstateAgent,
  rootReducer,
  seedGenesis,
  suspendAgent,
  vouchFor,
} from "../../src/environment";
import { replayState, SYSTEM_ACTOR } from "../../src/foundation";
import { defineRegion, makeInstitutions } from "../../src/region";

const NOTARY = keyPairFromSeed(new Uint8Array(32).fill(7));
const pub = (n: number) => encodeBase64(keyPairFromSeed(new Uint8Array(32).fill(n)).publicKey);

const lenient = () =>
  makeInstitutions({
    verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false },
    diplomacyPolicy: { defaultStance: "absorb", overrides: {} },
  });

function twoRegionWorld() {
  const world = createAlmaWorld("sanctions");
  seedGenesis(world, [defineRegion("umi", "Umi", lenient()), defineRegion("nova", "Nova", lenient())]);
  admitTreasury(world, "umi");
  admitTreasury(world, "nova");
  admitAgent(world, { id: "alice@umi", region: "umi", role: "merchant", valueProfile: "lenient", publicKey: pub(1), currency: 100 });
  admitAgent(world, { id: "bob@umi", region: "umi", role: "artisan", valueProfile: "lenient", publicKey: pub(2), currency: 50 });
  return world;
}

describe("RFC 0007 §9 — sanctions", () => {
  // K1 -----------------------------------------------------------------------
  test("suspension blocks executeTransfer (K1)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 10);

    const res = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 5, notary: NOTARY });
    expect(res).toEqual({ ok: false, reason: "suspended" });
  });

  test("suspension blocks transfer even at tick == untilTick (inclusive, K1)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 5);

    const res = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 5, notary: NOTARY });
    expect(res).toEqual({ ok: false, reason: "suspended" });
  });

  // K2 -----------------------------------------------------------------------
  test("suspension does NOT block emigration (Tier K-5, K2)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 100);

    // immigrate() in population.ts is independent of executeTransfer — no suspension check there
    expect(() => immigrate(world, "alice@umi", "nova")).not.toThrow();
    expect(getAgent(world.getState(), "alice@umi")?.region).toBe("nova");
  });

  // K3 -----------------------------------------------------------------------
  test("reinstateAgent lifts suspension early (K3)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 100);
    reinstateAgent(world, "alice@umi");

    // transfer should now succeed
    const res = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 5, notary: NOTARY });
    expect(res.ok).toBe(true);
  });

  test("reinstateAgent on a non-suspended agent is ok / idempotent (K3)", () => {
    const world = twoRegionWorld();
    const res = reinstateAgent(world, "alice@umi");
    expect(res).toEqual({ ok: true });
    // agent is not suspended — state unchanged
    expect(getAgent(world.getState(), "alice@umi")?.suspension).toBeNull();
  });

  // K4 -----------------------------------------------------------------------
  test("suspension auto-expires after untilTick (K4)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 3);

    // at tick 3 still blocked (inclusive)
    const stillBlocked = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 3, notary: NOTARY });
    expect(stillBlocked.ok).toBe(false);

    // at tick 4 the suspension has expired
    const expired = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 4, notary: NOTARY });
    expect(expired.ok).toBe(true);
  });

  test("isAgentSuspended helper matches the same boundary (K4)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 3);
    const alice = getAgent(world.getState(), "alice@umi")!;
    expect(isAgentSuspended(alice, 3)).toBe(true);
    expect(isAgentSuspended(alice, 4)).toBe(false);
  });

  // K5 -----------------------------------------------------------------------
  test("sanction events do not change currency supply (K5)", () => {
    const world = twoRegionWorld();
    const before = currencySupply(world.getState());

    suspendAgent(world, "alice@umi", 10);
    reinstateAgent(world, "alice@umi");

    expect(currencySupply(world.getState())).toBe(before);
  });

  test("suspended agent's balance is unchanged (K5)", () => {
    const world = twoRegionWorld();
    const balanceBefore = getAgent(world.getState(), "alice@umi")!.balances.currency;

    suspendAgent(world, "alice@umi", 10);

    expect(getAgent(world.getState(), "alice@umi")?.balances.currency).toBe(balanceBefore);
  });

  // K6 -----------------------------------------------------------------------
  test("forged agent.suspended (non-SYSTEM_ACTOR) is ignored by reducer (K6)", () => {
    const world = twoRegionWorld();

    // emit as the agent itself — not SYSTEM_ACTOR — the reducer's actor-gate must drop this
    world.emit(EVENT_AGENT_SUSPENDED, "alice@umi", { agentId: "alice@umi", untilTick: 999 });

    // suspension must NOT have been applied
    const alice = getAgent(world.getState(), "alice@umi");
    expect(alice?.suspension).toBeNull();

    // transfer still succeeds
    const res = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 5, notary: NOTARY });
    expect(res.ok).toBe(true);
  });

  // K7 -----------------------------------------------------------------------
  test("replayState equals live state after sanctions (K7)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 5);
    executeTransfer(world, { from: "bob@umi", to: "alice@umi", amount: 10 }, { tick: 1, notary: NOTARY }); // bob can still transact
    reinstateAgent(world, "alice@umi");
    executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 20 }, { tick: 2, notary: NOTARY });

    const replayed = replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer);
    expect(replayed.state).toEqual(world.getState());
    expect(replayed.tick).toBe(world.tick);
  });

  // K8 -----------------------------------------------------------------------
  test("computeStanding returns trust accumulated from vouches (K8)", () => {
    const world = twoRegionWorld();
    expect(computeStanding(world.getState(), "alice@umi")).toBe(0);

    vouchFor(world, "bob@umi", "alice@umi", 3);
    expect(computeStanding(world.getState(), "alice@umi")).toBe(3);

    vouchFor(world, "bob@umi", "alice@umi", 2);
    expect(computeStanding(world.getState(), "alice@umi")).toBe(5);
  });

  test("computeStanding returns 0 for unknown agent (K8)", () => {
    const world = twoRegionWorld();
    expect(computeStanding(world.getState(), "unknown@umi")).toBe(0);
  });

  // K9 -----------------------------------------------------------------------
  test("sponsors stored at admission (K9)", () => {
    const world = twoRegionWorld();
    admitAgent(world, {
      id: "carol@umi",
      region: "umi",
      role: "artisan",
      valueProfile: "lenient",
      publicKey: pub(3),
      sponsors: ["alice@umi", "bob@umi"],
    });
    const carol = getAgent(world.getState(), "carol@umi");
    expect(carol?.sponsors).toEqual(["alice@umi", "bob@umi"]);
  });

  test("sponsors default to empty array when omitted (K9)", () => {
    const world = twoRegionWorld();
    const alice = getAgent(world.getState(), "alice@umi");
    expect(alice?.sponsors).toEqual([]);
  });

  // validation ---------------------------------------------------------------
  test("suspendAgent rejects unknown agent", () => {
    const world = twoRegionWorld();
    const res = suspendAgent(world, "ghost@umi", 10);
    expect(res).toEqual({ ok: false, reason: "unknown-agent" });
  });

  test("suspendAgent rejects negative untilTick", () => {
    const world = twoRegionWorld();
    const res = suspendAgent(world, "alice@umi", -1);
    expect(res).toEqual({ ok: false, reason: "bad-until-tick" });
  });

  test("suspendAgent rejects non-integer untilTick", () => {
    const world = twoRegionWorld();
    const res = suspendAgent(world, "alice@umi", 1.5);
    expect(res).toEqual({ ok: false, reason: "bad-until-tick" });
  });

  test("reinstateAgent rejects unknown agent", () => {
    const world = twoRegionWorld();
    const res = reinstateAgent(world, "ghost@umi");
    expect(res).toEqual({ ok: false, reason: "unknown-agent" });
  });

  test("second suspend REPLACES the first (later sentence wins)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 5);
    suspendAgent(world, "alice@umi", 20);
    const alice = getAgent(world.getState(), "alice@umi");
    expect(alice?.suspension?.untilTick).toBe(20);
  });
});
