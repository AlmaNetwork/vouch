// `migrate` — the exit option. The disadvantaged moving on is a load-bearing part of
// what this world is for (README), and until now the engine could do it while nothing
// over the network could ask for it.
//
// The distinction the tests keep coming back to: RESIDENCE moves, CITIZENSHIP does not.
// An agent's id encodes where it was born and never changes, so `ann@umi` living in
// yama is a resident of yama and a citizen of umi — which is exactly what
// sanctions.ts reads when deciding who may act on someone.

import { describe, expect, test } from "bun:test";
import { getAgent } from "vouch-world/agent";
import { MemoryAccountLog } from "../src/account-log";
import { MemoryJournal } from "../src/journal";
import { VouchNode } from "../src/node";
import { keypair, signCommand, signRegister } from "./helpers";

const ALICE = keypair(1);
const ANN = keypair(2);

/** alice owns umi + yama; ann@umi is a resident of umi with her own key registered. */
function twoRegionWorld(): VouchNode {
  const node = new VouchNode({ seed: "m", notary: keypair(7), journal: new MemoryJournal(), accountLog: new MemoryAccountLog() });
  expect(node.register(signRegister("alice", 0, ALICE)).ok).toBe(true);
  expect(node.submit(signCommand("alice", 1, { kind: "found", regionId: "umi", displayName: "Umi" }, ALICE)).ok).toBe(true);
  expect(node.submit(signCommand("alice", 2, { kind: "found", regionId: "yama", displayName: "Yama" }, ALICE)).ok).toBe(true);
  expect(
    node.submit(signCommand("alice", 3, { kind: "admit", agentId: "ann@umi", region: "umi", role: "merchant", currency: 50 }, ALICE)).ok,
  ).toBe(true);
  expect(node.register(signRegister("ann@umi", 0, ANN)).ok).toBe(true);
  return node;
}

const migrate = (n: number, to: string, as = "ann@umi", key = ANN) =>
  signCommand(as, n, { kind: "migrate", agentId: as, toRegion: to }, key);

describe("migrate", () => {
  test("moves residence, and the balance travels with the agent", () => {
    const node = twoRegionWorld();
    const res = node.submit(migrate(1, "yama"));

    expect(res.ok).toBe(true);
    const ann = getAgent(node.world.getState(), "ann@umi");
    expect(ann?.region).toBe("yama");
    expect(ann?.balances.currency).toBe(50);
  });

  test("citizenship does not move — the id keeps its birth region", () => {
    const node = twoRegionWorld();
    node.submit(migrate(1, "yama"));

    const ann = getAgent(node.world.getState(), "ann@umi");
    expect(ann?.id).toBe("ann@umi"); // still a citizen of umi
    expect(ann?.region).toBe("yama"); // resident of yama
  });

  test("a second move works, and still uses the birth-region id", () => {
    const node = twoRegionWorld();
    expect(node.submit(migrate(1, "yama")).ok).toBe(true);
    expect(node.submit(migrate(2, "umi")).ok).toBe(true);
    expect(getAgent(node.world.getState(), "ann@umi")?.region).toBe("umi");
  });
});

describe("migrate — authorization", () => {
  // There is no expulsion in this world. An owner governs a region, not the people in
  // it: they cannot push a resident out, and nobody can pull someone in.
  test("a region owner cannot move somebody else", () => {
    const node = twoRegionWorld();
    const res = node.submit(signCommand("alice", 4, { kind: "migrate", agentId: "ann@umi", toRegion: "yama" }, ALICE));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("not-self");
    expect(getAgent(node.world.getState(), "ann@umi")?.region).toBe("umi");
  });

  test("an unsigned move is refused before authorization is even considered", () => {
    const node = twoRegionWorld();
    const res = node.submit(signCommand("ann@umi", 1, { kind: "migrate", agentId: "ann@umi", toRegion: "yama" }, keypair(99)));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(401);
  });
});

describe("migrate — refusals that keep the journal clean", () => {
  // The journal is permanent, so a move that changes nothing must not be recorded.
  // `immigrate` would emit for it happily; refusing here is what stops a free
  // back-and-forth loop from growing the log.
  test("moving to where you already are is refused and journals nothing", () => {
    const node = twoRegionWorld();
    const before = node.world.log.length;
    const res = node.submit(migrate(1, "umi"));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("already-resident");
    expect(node.world.log.length).toBe(before);
  });

  test("moving to a region that does not exist is refused", () => {
    const node = twoRegionWorld();
    const before = node.world.log.length;
    const res = node.submit(migrate(1, "nowhere"));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("unknown-region");
    expect(node.world.log.length).toBe(before);
  });

  test("an agent that was never admitted cannot move", () => {
    const node = twoRegionWorld();
    const ghost = keypair(5);
    expect(node.register(signRegister("ghost@umi", 0, ghost)).ok).toBe(true);
    const res = node.submit(migrate(1, "yama", "ghost@umi", ghost));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("unknown-agent");
  });
});

describe("migrate — what the world records", () => {
  test("the move is counted as mobility, which is what /metrics watches for", async () => {
    const node = twoRegionWorld();
    node.submit(migrate(1, "yama"));

    const { metrics } = await import("vouch-world/observation");
    const m = metrics(node.world);
    expect(m.mobility.migrations).toBe(1);
  });

  test("per-region residency follows the move on both sides", async () => {
    const node = twoRegionWorld();
    const { metrics } = await import("vouch-world/observation");
    const before = metrics(node.world).perRegion;
    expect(before.find((r) => r.id === "umi")?.residents).toBe(1);
    expect(before.find((r) => r.id === "yama")?.residents).toBe(0);

    node.submit(migrate(1, "yama"));

    const after = metrics(node.world).perRegion;
    expect(after.find((r) => r.id === "umi")?.residents).toBe(0);
    expect(after.find((r) => r.id === "yama")?.residents).toBe(1);
  });

  test("a migrated agent survives a restart in its new region", () => {
    const journal = new MemoryJournal();
    const accountLog = new MemoryAccountLog();
    const first = new VouchNode({ seed: "m", notary: keypair(7), journal, accountLog });
    first.register(signRegister("alice", 0, ALICE));
    first.submit(signCommand("alice", 1, { kind: "found", regionId: "umi", displayName: "Umi" }, ALICE));
    first.submit(signCommand("alice", 2, { kind: "found", regionId: "yama", displayName: "Yama" }, ALICE));
    first.submit(signCommand("alice", 3, { kind: "admit", agentId: "ann@umi", region: "umi", role: "merchant" }, ALICE));
    first.register(signRegister("ann@umi", 0, ANN));
    expect(first.submit(migrate(1, "yama")).ok).toBe(true);

    const rebooted = new VouchNode({ seed: "m", notary: keypair(7), journal, accountLog });
    expect(getAgent(rebooted.world.getState(), "ann@umi")?.region).toBe("yama");
  });
});
