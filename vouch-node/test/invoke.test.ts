// Wiring the RFC 0007 §4 data-defined command engine onto the network.
//
// #46 built the engine and left it unreachable: `executeCommand` was exported and
// nothing called it, `seedCoreDefinitions` existed and no boot path ran it. Its README
// says so — "Not yet wired into the HTTP surface — the migration off the hardcoded
// switch is a follow-up." This is that follow-up's first half.
//
// The claim worth testing is #46's own: a definition that lives in the log as DATA
// produces byte-identical events to the hardcoded switch. #46 proved it in-process;
// these prove it through the real signed path, which is where it has to hold.

import { describe, expect, test } from "bun:test";
import { getAgent } from "vouch-world/agent";
import { listDefinitions } from "vouch-world/definition";
import { MemoryAccountLog } from "../src/account-log";
import { createNodeApp } from "../src/http";
import { MemoryJournal } from "../src/journal";
import { VouchNode } from "../src/node";
import { CORE_DEFINITIONS } from "../src/seed-definitions";
import { keypair, signCommand, signRegister } from "./helpers";

const ALICE = keypair(1);
const ANN = keypair(2);

/** alice owns umi; ann@umi holds 500 and has her own key; bo@umi is a counterparty. */
function world(): VouchNode {
  const node = new VouchNode({ seed: "iv", notary: keypair(7), journal: new MemoryJournal(), accountLog: new MemoryAccountLog() });
  expect(node.register(signRegister("alice", 0, ALICE)).ok).toBe(true);
  expect(node.submit(signCommand("alice", 1, { kind: "found", regionId: "umi", displayName: "Umi" }, ALICE)).ok).toBe(true);
  expect(
    node.submit(signCommand("alice", 2, { kind: "admit", agentId: "ann@umi", region: "umi", role: "merchant", currency: 500 }, ALICE)).ok,
  ).toBe(true);
  expect(node.submit(signCommand("alice", 3, { kind: "admit", agentId: "bo@umi", region: "umi", role: "broker" }, ALICE)).ok).toBe(true);
  expect(node.register(signRegister("ann@umi", 0, ANN)).ok).toBe(true);
  return node;
}

const invoke = (n: number, definitionId: string, payload: Record<string, unknown>) =>
  signCommand("ann@umi", n, { kind: "invoke", definitionId, payload }, ANN);

describe("boot seeding", () => {
  test("a fresh node comes up with the core definitions already in the log", () => {
    const node = new VouchNode({ seed: "iv", notary: keypair(7), journal: new MemoryJournal(), accountLog: new MemoryAccountLog() });
    const ids = listDefinitions(node.world.getState()).map((d) => d.id);
    expect(ids).toEqual(CORE_DEFINITIONS.map((d) => d.id).sort());
  });

  // The runnable command set is reproducible state (RFC 0007 P1), so seeding is a WRITE
  // and has to reach the journal — otherwise the live world and its journal disagree
  // and the next boot loses the definitions.
  test("seeding is journalled, so it survives a restart", () => {
    const journal = new MemoryJournal();
    const accountLog = new MemoryAccountLog();
    new VouchNode({ seed: "iv", notary: keypair(7), journal, accountLog });
    expect(journal.load().length).toBeGreaterThan(0);

    const rebooted = new VouchNode({ seed: "iv", notary: keypair(7), journal, accountLog });
    expect(listDefinitions(rebooted.world.getState()).map((d) => d.id)).toEqual(CORE_DEFINITIONS.map((d) => d.id).sort());
  });

  // putDefinition refuses to revise an existing core.* definition and returns BEFORE
  // committing, so re-seeding on every boot emits nothing. If that ever changed, a
  // restarted node would append duplicates forever.
  test("rebooting does not append the definitions again", () => {
    const journal = new MemoryJournal();
    const accountLog = new MemoryAccountLog();
    new VouchNode({ seed: "iv", notary: keypair(7), journal, accountLog });
    const afterFirst = journal.load().length;

    new VouchNode({ seed: "iv", notary: keypair(7), journal, accountLog });
    new VouchNode({ seed: "iv", notary: keypair(7), journal, accountLog });
    expect(journal.load().length).toBe(afterFirst);
  });
});

describe("invoke — the data-defined path produces the same world as the hardcoded one", () => {
  // #46's central claim, re-checked through the signed network path rather than
  // in-process: if these diverge, the migration off the switch cannot be safe.
  test("core.transfer emits byte-identical events to kind:'transfer'", () => {
    const viaSwitch = world();
    expect(viaSwitch.submit(signCommand("ann@umi", 1, { kind: "transfer", from: "ann@umi", to: "bo@umi", amount: 100 }, ANN)).ok).toBe(
      true,
    );

    const viaDefinition = world();
    expect(viaDefinition.submit(invoke(1, "core.transfer", { from: "ann@umi", to: "bo@umi", amount: 100 })).ok).toBe(true);

    expect(viaDefinition.world.log.digest()).toBe(viaSwitch.world.log.digest());
  });

  test("core.vouch emits byte-identical events to kind:'vouch'", () => {
    const viaSwitch = world();
    expect(viaSwitch.submit(signCommand("ann@umi", 1, { kind: "vouch", from: "ann@umi", to: "bo@umi", weight: 3 }, ANN)).ok).toBe(true);

    const viaDefinition = world();
    expect(viaDefinition.submit(invoke(1, "core.vouch", { from: "ann@umi", to: "bo@umi", weight: 3 })).ok).toBe(true);

    expect(viaDefinition.world.log.digest()).toBe(viaSwitch.world.log.digest());
  });

  test("the money actually moved", () => {
    const node = world();
    expect(node.submit(invoke(1, "core.transfer", { from: "ann@umi", to: "bo@umi", amount: 100 })).ok).toBe(true);
    expect(getAgent(node.world.getState(), "ann@umi")?.balances.currency).toBe(400);
    expect(getAgent(node.world.getState(), "bo@umi")?.balances.currency).toBe(80); // 100 less the 20% fee
  });
});

describe("invoke — authority comes from the same place as every other command", () => {
  // `isSelf` on `$.from` is the definition's own precondition, evaluated against the
  // authenticated actor. Data-defined does not mean unauthenticated.
  test("you cannot spend someone else's money by naming them", () => {
    const node = world();
    const res = node.submit(invoke(1, "core.transfer", { from: "bo@umi", to: "ann@umi", amount: 50 }));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("precondition-failed:isSelf");
  });

  test("an unsigned invoke is refused before the interpreter runs", () => {
    const node = world();
    const res = node.submit(signCommand("ann@umi", 1, { kind: "invoke", definitionId: "core.transfer", payload: {} }, keypair(99)));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(401);
  });
});

describe("invoke — refusals", () => {
  test("an unknown definition is refused", () => {
    const node = world();
    const before = node.world.log.length;
    const res = node.submit(invoke(1, "core.nope", {}));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("unknown-definition");
    expect(node.world.log.length).toBe(before);
  });

  test("a primitive-level reason passes through unflattened", () => {
    const node = world();
    const res = node.submit(invoke(1, "core.transfer", { from: "ann@umi", to: "bo@umi", amount: 999_999 }));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("insufficient-funds");
  });
});

describe("invoke — the payload is bounded like every other write", () => {
  const bad = (n: number, payload: unknown) => signCommand("ann@umi", n, { kind: "invoke", definitionId: "core.transfer", payload }, ANN);

  // The kernel resolves `$.field` and hands the result to asString/asNumber, so a
  // nested value could never be read meaningfully — admitting only scalars is faithful
  // to what the interpreter can use AND bounds the payload.
  test("a nested object is refused", () => {
    const node = world();
    const res = node.submit(bad(1, { from: { evil: true } }));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(400);
  });

  test("a huge string value is refused", () => {
    const node = world();
    expect(node.submit(bad(1, { from: "a".repeat(100 * 1024) })).ok).toBe(false);
  });

  test("too many fields are refused", () => {
    const node = world();
    const payload = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, i]));
    expect(node.submit(bad(1, payload)).ok).toBe(false);
  });

  test("an oversized definition id is refused", () => {
    const node = world();
    const res = node.submit(signCommand("ann@umi", 1, { kind: "invoke", definitionId: "a".repeat(5000), payload: {} }, ANN));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(400);
  });
});

describe("definitions are discoverable over HTTP", () => {
  test("GET /definitions lists what can be invoked", async () => {
    const app = createNodeApp(world());
    const res = await app.request("/definitions");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((d) => d.id)).toEqual(CORE_DEFINITIONS.map((d) => d.id).sort());
  });

  test("GET /definitions/:id returns one, and 404s for an unknown id", async () => {
    const app = createNodeApp(world());
    const found = await app.request("/definitions/core.transfer");
    expect(found.status).toBe(200);
    expect(((await found.json()) as { id: string }).id).toBe("core.transfer");

    expect((await app.request("/definitions/core.nope")).status).toBe(404);
  });
});
