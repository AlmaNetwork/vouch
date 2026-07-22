// RFC 0007 §9 — sanction primitives: suspendId / reinstateId (+ §6 authorization, §10.1 sponsors)
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
//   A1-A4: §6 authorization — dual-authority (citizenship OR residence region)

import { describe, expect, test } from "bun:test";
import { encodeBase64, keyPairFromSeed } from "vouch-core";
import { computeStanding, currencySupply, EVENT_AGENT_SUSPENDED, getAgent, isAgentSuspended } from "../../src/agent";
import {
  admitAgent,
  admitTreasury,
  createAlmaWorld,
  executeTransfer,
  experimenterProposal,
  INITIAL_WORLD_STATE,
  immigrate,
  proposeFounding,
  reinstateAgent,
  rootReducer,
  suspendAgent,
  vouchFor,
} from "../../src/environment";
import { replayState } from "../../src/foundation";
import { defineRegion, makeInstitutions } from "../../src/region";

const NOTARY = keyPairFromSeed(new Uint8Array(32).fill(7));
const pub = (n: number) => encodeBase64(keyPairFromSeed(new Uint8Array(32).fill(n)).publicKey);

// the region governors (owners) — the authorities that may sanction their members.
const UMI_MAYOR = "mayor@umi";
const NOVA_MAYOR = "mayor@nova";

const lenient = () =>
  makeInstitutions({
    verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false },
    diplomacyPolicy: { defaultStance: "absorb", overrides: {} },
  });

// Founded via experimenterProposal with an explicit OWNER so canGovern has a subject
// (genesis regions are system-owned / owner-null → no one can govern them).
function twoRegionWorld() {
  const world = createAlmaWorld("sanctions");
  proposeFounding(world, experimenterProposal(defineRegion("umi", "Umi", lenient()), undefined, UMI_MAYOR));
  proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", lenient()), undefined, NOVA_MAYOR));
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
    suspendAgent(world, "alice@umi", 10, UMI_MAYOR);

    const res = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 5, notary: NOTARY });
    expect(res).toEqual({ ok: false, reason: "suspended" });
  });

  test("suspension blocks transfer even at tick == untilTick (inclusive, K1)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 5, UMI_MAYOR);

    const res = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 5, notary: NOTARY });
    expect(res).toEqual({ ok: false, reason: "suspended" });
  });

  // K2 -----------------------------------------------------------------------
  test("suspension does NOT block emigration (Tier K-5, K2)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 100, UMI_MAYOR);

    // immigrate() in population.ts is independent of executeTransfer — no suspension check there
    expect(() => immigrate(world, "alice@umi", "nova")).not.toThrow();
    expect(getAgent(world.getState(), "alice@umi")?.region).toBe("nova");
  });

  // K3 -----------------------------------------------------------------------
  test("reinstateAgent lifts suspension early (K3)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 100, UMI_MAYOR);
    reinstateAgent(world, "alice@umi", UMI_MAYOR);

    const res = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 5, notary: NOTARY });
    expect(res.ok).toBe(true);
  });

  test("reinstateAgent on a non-suspended agent is ok / idempotent (K3)", () => {
    const world = twoRegionWorld();
    const res = reinstateAgent(world, "alice@umi", UMI_MAYOR);
    expect(res).toEqual({ ok: true });
    expect(getAgent(world.getState(), "alice@umi")?.suspension).toBeNull();
  });

  // K4 -----------------------------------------------------------------------
  test("suspension auto-expires after untilTick (K4)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 3, UMI_MAYOR);

    const stillBlocked = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 3, notary: NOTARY });
    expect(stillBlocked.ok).toBe(false);

    const expired = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 4, notary: NOTARY });
    expect(expired.ok).toBe(true);
  });

  test("isAgentSuspended helper matches the same boundary (K4)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 3, UMI_MAYOR);
    const alice = getAgent(world.getState(), "alice@umi")!;
    expect(isAgentSuspended(alice, 3)).toBe(true);
    expect(isAgentSuspended(alice, 4)).toBe(false);
  });

  // K5 -----------------------------------------------------------------------
  test("sanction events do not change currency supply (K5)", () => {
    const world = twoRegionWorld();
    const before = currencySupply(world.getState());

    suspendAgent(world, "alice@umi", 10, UMI_MAYOR);
    reinstateAgent(world, "alice@umi", UMI_MAYOR);

    expect(currencySupply(world.getState())).toBe(before);
  });

  test("suspended agent's balance is unchanged (K5)", () => {
    const world = twoRegionWorld();
    const balanceBefore = getAgent(world.getState(), "alice@umi")!.balances.currency;

    suspendAgent(world, "alice@umi", 10, UMI_MAYOR);

    expect(getAgent(world.getState(), "alice@umi")?.balances.currency).toBe(balanceBefore);
  });

  // K6 -----------------------------------------------------------------------
  test("forged agent.suspended (non-SYSTEM_ACTOR) is ignored by reducer (K6)", () => {
    const world = twoRegionWorld();

    // emit as the agent itself — not SYSTEM_ACTOR — the reducer's actor-gate must drop this
    world.emit(EVENT_AGENT_SUSPENDED, "alice@umi", { agentId: "alice@umi", untilTick: 999 });

    const alice = getAgent(world.getState(), "alice@umi");
    expect(alice?.suspension).toBeNull();

    const res = executeTransfer(world, { from: "alice@umi", to: "bob@umi", amount: 10 }, { tick: 5, notary: NOTARY });
    expect(res.ok).toBe(true);
  });

  // K7 -----------------------------------------------------------------------
  test("replayState equals live state after sanctions (K7)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 5, UMI_MAYOR);
    executeTransfer(world, { from: "bob@umi", to: "alice@umi", amount: 10 }, { tick: 1, notary: NOTARY }); // bob can still transact
    reinstateAgent(world, "alice@umi", UMI_MAYOR);
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
    const res = suspendAgent(world, "ghost@umi", 10, UMI_MAYOR);
    expect(res).toEqual({ ok: false, reason: "unknown-agent" });
  });

  test("suspendAgent rejects negative untilTick", () => {
    const world = twoRegionWorld();
    const res = suspendAgent(world, "alice@umi", -1, UMI_MAYOR);
    expect(res).toEqual({ ok: false, reason: "bad-until-tick" });
  });

  test("suspendAgent rejects non-integer untilTick", () => {
    const world = twoRegionWorld();
    const res = suspendAgent(world, "alice@umi", 1.5, UMI_MAYOR);
    expect(res).toEqual({ ok: false, reason: "bad-until-tick" });
  });

  test("reinstateAgent rejects unknown agent", () => {
    const world = twoRegionWorld();
    const res = reinstateAgent(world, "ghost@umi", UMI_MAYOR);
    expect(res).toEqual({ ok: false, reason: "unknown-agent" });
  });

  test("second suspend REPLACES the first (later sentence wins)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 5, UMI_MAYOR);
    suspendAgent(world, "alice@umi", 20, UMI_MAYOR);
    const alice = getAgent(world.getState(), "alice@umi");
    expect(alice?.suspension?.untilTick).toBe(20);
  });
});

describe("RFC 0007 §6 — sanction authorization (dual-authority)", () => {
  // A1 -----------------------------------------------------------------------
  test("a non-authority cannot suspend (A1)", () => {
    const world = twoRegionWorld();
    const res = suspendAgent(world, "alice@umi", 10, "bob@umi"); // bob is a resident, not the owner
    expect(res).toEqual({ ok: false, reason: "not-authorized" });
    expect(getAgent(world.getState(), "alice@umi")?.suspension).toBeNull();
  });

  // A2 -----------------------------------------------------------------------
  test("an authority of an UNRELATED region cannot suspend (A2)", () => {
    const world = twoRegionWorld();
    // nova's mayor governs neither alice's citizenship (umi) nor her residence (umi).
    const res = suspendAgent(world, "alice@umi", 10, NOVA_MAYOR);
    expect(res).toEqual({ ok: false, reason: "not-authorized" });
  });

  // A3 -----------------------------------------------------------------------
  test("the CITIZENSHIP-region authority can suspend even after migration (A3)", () => {
    const world = twoRegionWorld();
    immigrate(world, "alice@umi", "nova"); // residence now nova, citizenship still umi
    const res = suspendAgent(world, "alice@umi", 10, UMI_MAYOR);
    expect(res.ok).toBe(true);
    expect(getAgent(world.getState(), "alice@umi")?.suspension?.untilTick).toBe(10);
  });

  // A4 -----------------------------------------------------------------------
  test("the RESIDENCE-region authority can suspend after migration (A4)", () => {
    const world = twoRegionWorld();
    immigrate(world, "alice@umi", "nova"); // residence now nova
    const res = suspendAgent(world, "alice@umi", 10, NOVA_MAYOR);
    expect(res.ok).toBe(true);
    expect(getAgent(world.getState(), "alice@umi")?.suspension?.untilTick).toBe(10);
  });

  test("reinstate is subject to the same authorization (A1 mirror)", () => {
    const world = twoRegionWorld();
    suspendAgent(world, "alice@umi", 10, UMI_MAYOR);
    const res = reinstateAgent(world, "alice@umi", "bob@umi");
    expect(res).toEqual({ ok: false, reason: "not-authorized" });
    // still suspended
    expect(getAgent(world.getState(), "alice@umi")?.suspension?.untilTick).toBe(10);
  });
});
