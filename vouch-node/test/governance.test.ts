// Governance over the network — `amend`, `propose`, `vote`.
//
// This is the command group that makes the README's premise testable. With one
// governance model reachable there is nothing to compare, so "watch which institutions
// prosper" has no subject; a region that can change its own rules is the subject.
//
// Two things these tests keep checking. First, WHO may act is the engine's call
// (`canGovern`) and the node only translates the refusal into a readable reason.
// Second, institutions are the widest payload a participant can write, and every
// collection in them is journalled forever — so the bounds get the same attention the
// identifier grammar and the balance ceiling got.

import { describe, expect, test } from "bun:test";
import { getRegion, MAX_COUNCIL_MEMBERS, MAX_SCHEMA_ENTRIES } from "vouch-world/region";
import { MemoryAccountLog } from "../src/account-log";
import { MemoryJournal } from "../src/journal";
import { VouchNode } from "../src/node";
import { keypair, signCommand, signRegister } from "./helpers";

const ALICE = keypair(1);
const BOB = keypair(2);
const CAROL = keypair(3);

const CHEAPER = {
  policy: "economy" as const,
  value: { baseCostRate: 0.1, minCostRate: 0.02, repDiscount: 0.01, creditPerTx: 2 },
};

/** alice founds umi and governs it as a dictator (the default at `found`). */
function dictatorship(): VouchNode {
  const node = new VouchNode({ seed: "g", notary: keypair(7), journal: new MemoryJournal(), accountLog: new MemoryAccountLog() });
  expect(node.register(signRegister("alice", 0, ALICE)).ok).toBe(true);
  expect(node.submit(signCommand("alice", 1, { kind: "found", regionId: "umi", displayName: "Umi" }, ALICE)).ok).toBe(true);
  return node;
}

/** Turn umi into a council of alice+bob with the given threshold. Returns the next nonce. */
function toCouncil(node: VouchNode, nonce: number, threshold: number, members = ["alice", "bob"]): number {
  const res = node.submit(
    signCommand(
      "alice",
      nonce,
      { kind: "amend", regionId: "umi", change: { policy: "governance", value: { kind: "council", members, threshold } } },
      ALICE,
    ),
  );
  expect(res.ok).toBe(true);
  return nonce + 1;
}

describe("amend — a dictator changes the rules", () => {
  test("the economy policy actually changes", () => {
    const node = dictatorship();
    const res = node.submit(signCommand("alice", 2, { kind: "amend", regionId: "umi", change: CHEAPER }, ALICE));

    expect(res.ok).toBe(true);
    const policy = getRegion(node.world.getState(), "umi")?.institutions.economyPolicy;
    expect(policy?.baseCostRate).toBe(0.1);
    expect(policy?.creditPerTx).toBe(2);
  });

  test("a cheaper policy is visible in what a transfer costs", () => {
    const node = dictatorship();
    node.submit(signCommand("alice", 2, { kind: "admit", agentId: "ann@umi", region: "umi", role: "merchant", currency: 500 }, ALICE));
    node.submit(signCommand("alice", 3, { kind: "admit", agentId: "bo@umi", region: "umi", role: "broker" }, ALICE));
    node.register(signRegister("ann@umi", 0, BOB));

    const before = node.submit(signCommand("ann@umi", 1, { kind: "transfer", from: "ann@umi", to: "bo@umi", amount: 100 }, BOB));
    expect(before.ok && before.detail?.fee).toBe(20); // 20% at reputation 0

    expect(node.submit(signCommand("alice", 4, { kind: "amend", regionId: "umi", change: CHEAPER }, ALICE)).ok).toBe(true);

    const after = node.submit(signCommand("ann@umi", 2, { kind: "transfer", from: "ann@umi", to: "bo@umi", amount: 100 }, BOB));
    expect(after.ok && after.detail?.fee).toBe(9); // 10% ceiling, minus 1 reputation x 0.01
  });

  test("a non-governor is refused with a reason, not a generic rejection", () => {
    const node = dictatorship();
    node.register(signRegister("mallory", 0, CAROL));
    const res = node.submit(signCommand("mallory", 1, { kind: "amend", regionId: "umi", change: CHEAPER }, CAROL));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("not-governor");
  });

  test("a council-governed region refuses a direct amend and says where to go", () => {
    const node = dictatorship();
    const n = toCouncil(node, 2, 2);
    const res = node.submit(signCommand("alice", n, { kind: "amend", regionId: "umi", change: CHEAPER }, ALICE));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("council-governed-use-propose");
  });

  test("an unknown region is refused before any engine work", () => {
    const node = dictatorship();
    const before = node.world.log.length;
    const res = node.submit(signCommand("alice", 2, { kind: "amend", regionId: "nowhere", change: CHEAPER }, ALICE));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("unknown-region");
    expect(node.world.log.length).toBe(before);
  });
});

describe("propose + vote — a council decides collectively", () => {
  test("a threshold-1 council resolves on the proposer's own ballot", () => {
    const node = dictatorship();
    const n = toCouncil(node, 2, 1);
    const res = node.submit(signCommand("alice", n, { kind: "propose", regionId: "umi", change: CHEAPER }, ALICE));

    expect(res.ok).toBe(true);
    // Resolved immediately: the open counts as the first ballot.
    expect(getRegion(node.world.getState(), "umi")?.openProposal).toBeNull();
    expect(getRegion(node.world.getState(), "umi")?.institutions.economyPolicy.baseCostRate).toBe(0.1);
  });

  test("a threshold-2 council needs the second member, and reports when it carries", () => {
    const node = dictatorship();
    let n = toCouncil(node, 2, 2);
    expect(node.submit(signCommand("alice", n++, { kind: "propose", regionId: "umi", change: CHEAPER }, ALICE)).ok).toBe(true);

    // Still open on one ballot; the policy has not moved.
    expect(getRegion(node.world.getState(), "umi")?.openProposal).not.toBeNull();
    expect(getRegion(node.world.getState(), "umi")?.institutions.economyPolicy.baseCostRate).toBe(0.2);

    node.register(signRegister("bob", 0, BOB));
    const res = node.submit(signCommand("bob", 1, { kind: "vote", regionId: "umi" }, BOB));

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.detail?.resolved).toBe(true);
    expect(getRegion(node.world.getState(), "umi")?.institutions.economyPolicy.baseCostRate).toBe(0.1);
  });

  test("only one proposal may be open at a time", () => {
    const node = dictatorship();
    let n = toCouncil(node, 2, 2);
    expect(node.submit(signCommand("alice", n++, { kind: "propose", regionId: "umi", change: CHEAPER }, ALICE)).ok).toBe(true);

    const res = node.submit(
      signCommand(
        "alice",
        n,
        { kind: "propose", regionId: "umi", change: { policy: "resource", value: { capacity: 5, regenPerTick: 1 } } },
        ALICE,
      ),
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("proposal-already-open");
  });

  test("a non-member cannot propose", () => {
    const node = dictatorship();
    const n = toCouncil(node, 2, 2);
    node.register(signRegister("mallory", 0, CAROL));
    const res = node.submit(signCommand("mallory", 1, { kind: "propose", regionId: "umi", change: CHEAPER }, CAROL));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("not-council-member");
  });

  test("a dictatorship refuses propose and points back at amend", () => {
    const node = dictatorship();
    const res = node.submit(signCommand("alice", 2, { kind: "propose", regionId: "umi", change: CHEAPER }, ALICE));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("not-council-governed");
  });

  test("voting with nothing open is refused", () => {
    const node = dictatorship();
    const n = toCouncil(node, 2, 2);
    const res = node.submit(signCommand("alice", n, { kind: "vote", regionId: "umi" }, ALICE));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("no-open-proposal");
  });

  test("voting twice is refused", () => {
    const node = dictatorship();
    let n = toCouncil(node, 2, 3, ["alice", "bob", "carol"]);
    expect(node.submit(signCommand("alice", n++, { kind: "propose", regionId: "umi", change: CHEAPER }, ALICE)).ok).toBe(true);

    const res = node.submit(signCommand("alice", n, { kind: "vote", regionId: "umi" }, ALICE));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("already-voted");
  });

  // The roll is the RFC 0001 §5 snapshot taken at open. Being a member NOW is not the
  // question — being on that roll is.
  test("someone outside the snapshot roll cannot vote", () => {
    const node = dictatorship();
    let n = toCouncil(node, 2, 2);
    expect(node.submit(signCommand("alice", n++, { kind: "propose", regionId: "umi", change: CHEAPER }, ALICE)).ok).toBe(true);
    node.register(signRegister("carol", 0, CAROL));

    const res = node.submit(signCommand("carol", 1, { kind: "vote", regionId: "umi" }, CAROL));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("not-on-roll");
  });
});

// Institutions are the widest payload a participant may write, and every collection in
// them is journalled forever. Same class of surface as the identifier grammar.
describe("institution bounds", () => {
  const amend = (n: number, change: unknown) => signCommand("alice", n, { kind: "amend", regionId: "umi", change }, ALICE);

  test("a council larger than the ceiling is refused, and journals nothing", () => {
    const node = dictatorship();
    const before = node.world.log.length;
    const members = Array.from({ length: MAX_COUNCIL_MEMBERS + 1 }, (_, i) => `m${i}`);
    const res = node.submit(amend(2, { policy: "governance", value: { kind: "council", members, threshold: 1 } }));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(400);
    expect(node.world.log.length).toBe(before);
  });

  test("a council right at the ceiling is accepted", () => {
    const node = dictatorship();
    const members = Array.from({ length: MAX_COUNCIL_MEMBERS }, (_, i) => `m${i}`);
    expect(node.submit(amend(2, { policy: "governance", value: { kind: "council", members, threshold: 1 } })).ok).toBe(true);
  });

  test("an oversized schema ledger is refused", () => {
    const node = dictatorship();
    const value = Array.from({ length: MAX_SCHEMA_ENTRIES + 1 }, (_, i) => ({ schemaId: `s${i}` }));
    expect(node.submit(amend(2, { policy: "schemaLedger", value })).ok).toBe(false);
  });

  test("a 200KB schema id is refused", () => {
    const node = dictatorship();
    const res = node.submit(amend(2, { policy: "schemaLedger", value: [{ schemaId: "a".repeat(200 * 1024) }] }));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(400);
  });

  test("a fee rate above 1 is refused — it would exceed the amount transferred", () => {
    const node = dictatorship();
    const res = node.submit(amend(2, { policy: "economy", value: { baseCostRate: 5, minCostRate: 0, repDiscount: 0, creditPerTx: 1 } }));
    expect(res.ok).toBe(false);
  });

  test("an unbounded creditPerTx is refused", () => {
    const node = dictatorship();
    const value = { baseCostRate: 0.2, minCostRate: 0.05, repDiscount: 0.02, creditPerTx: Number.MAX_SAFE_INTEGER };
    expect(node.submit(amend(2, { policy: "economy", value })).ok).toBe(false);
  });

  test("an unknown policy kind is refused", () => {
    const node = dictatorship();
    expect(node.submit(amend(2, { policy: "vibes", value: {} })).ok).toBe(false);
  });

  test("a diplomacy stance outside the four is refused", () => {
    const node = dictatorship();
    expect(node.submit(amend(2, { policy: "diplomacy", value: { defaultStance: "hostile", overrides: {} } })).ok).toBe(false);
  });
});

describe("governance survives a restart", () => {
  test("an amended policy replays", () => {
    const journal = new MemoryJournal();
    const accountLog = new MemoryAccountLog();
    const first = new VouchNode({ seed: "g", notary: keypair(7), journal, accountLog });
    first.register(signRegister("alice", 0, ALICE));
    first.submit(signCommand("alice", 1, { kind: "found", regionId: "umi", displayName: "Umi" }, ALICE));
    expect(first.submit(signCommand("alice", 2, { kind: "amend", regionId: "umi", change: CHEAPER }, ALICE)).ok).toBe(true);

    const rebooted = new VouchNode({ seed: "g", notary: keypair(7), journal, accountLog });
    expect(getRegion(rebooted.world.getState(), "umi")?.institutions.economyPolicy.baseCostRate).toBe(0.1);
  });
});
