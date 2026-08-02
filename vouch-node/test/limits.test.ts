// The write surface is bounded — in length and in value.
//
// Everything here was reachable through the real signed path before these bounds
// existed: a 200KB region id wrote 600KB into a journal that can never be trimmed,
// an `admit` of Number.MAX_SAFE_INTEGER pinned the publicly reported total currency
// supply there permanently, and a 100KB principal landed in an auth log that is
// replayed in full on every boot. See docs/LAUNCH.md for the measurements.

import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { MAX_IDENTIFIER_LENGTH, MAX_NAME_LENGTH, MAX_REGION_LENGTH } from "vouch-core";
import type { AlmaEvent } from "vouch-world/foundation";
import { MemoryAccountLog } from "../src/account-log";
import { MAX_PRINCIPAL_LENGTH } from "../src/accounts";
import { createNodeApp } from "../src/http";
import { MemoryJournal } from "../src/journal";
import { VouchNode } from "../src/node";
import { keypair, signCommand, signRegister } from "./helpers";

const ALICE = keypair(1);

function makeNode(): VouchNode {
  return new VouchNode({ seed: "l", notary: keypair(7), journal: new MemoryJournal(), accountLog: new MemoryAccountLog() });
}

/** A node with alice registered and owning region "nova". */
function novaNode(): VouchNode {
  const node = makeNode();
  expect(node.register(signRegister("acct:alice", 0, ALICE)).ok).toBe(true);
  expect(node.submit(signCommand("acct:alice", 1, { kind: "found", regionId: "nova", displayName: "Nova" }, ALICE)).ok).toBe(true);
  return node;
}

const huge = (n: number) => "a".repeat(n);

describe("write surface — length bounds", () => {
  test("an oversized regionId is refused, and nothing is journalled", () => {
    const node = novaNode();
    const before = node.world.log.length;
    const res = node.submit(signCommand("acct:alice", 2, { kind: "found", regionId: huge(200 * 1024), displayName: "big" }, ALICE));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(400); // rejected by the schema, before the engine
    expect(res.reason).toBe("invalid-command");
    expect(node.world.log.length).toBe(before);
  });

  test("a regionId is accepted at the limit and refused one character past it", () => {
    const node = novaNode();
    expect(
      node.submit(signCommand("acct:alice", 2, { kind: "found", regionId: huge(MAX_REGION_LENGTH), displayName: "ok" }, ALICE)).ok,
    ).toBe(true);
    expect(
      node.submit(signCommand("acct:alice", 3, { kind: "found", regionId: huge(MAX_REGION_LENGTH + 1), displayName: "no" }, ALICE)).ok,
    ).toBe(false);
  });

  test("an oversized displayName is refused — it has no grammar of its own to fall back on", () => {
    const node = novaNode();
    const before = node.world.log.length;
    const res = node.submit(signCommand("acct:alice", 2, { kind: "found", regionId: "big", displayName: huge(200 * 1024) }, ALICE));

    expect(res.ok).toBe(false);
    expect(node.world.log.length).toBe(before);
  });

  test("an oversized agentId at admit is refused", () => {
    const node = novaNode();
    const res = node.submit(
      signCommand(
        "acct:alice",
        2,
        { kind: "admit", agentId: `${huge(MAX_IDENTIFIER_LENGTH)}@nova`, region: "nova", role: "merchant" },
        ALICE,
      ),
    );
    expect(res.ok).toBe(false);
  });

  test("an oversized principal cannot be registered", () => {
    const node = makeNode();
    const res = node.register(signRegister(huge(MAX_PRINCIPAL_LENGTH + 1), 0, keypair(2)));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(400);
    expect(res.reason).toBe("principal-too-long");
  });

  test("a principal is accepted right at the limit", () => {
    const node = makeNode();
    expect(node.register(signRegister(huge(MAX_PRINCIPAL_LENGTH), 0, keypair(2))).ok).toBe(true);
  });

  // The two are tied on purpose: a resident agent id is `principal@region`, so a
  // principal that no name could hold would be registrable and then unable to act.
  test("the principal bound matches the identifier name bound", () => {
    expect(MAX_PRINCIPAL_LENGTH).toBe(MAX_NAME_LENGTH);
  });
});

describe("write surface — value bounds", () => {
  test("admit cannot mint an unbounded opening balance", () => {
    const node = novaNode();
    const res = node.submit(
      signCommand(
        "acct:alice",
        2,
        { kind: "admit", agentId: "greed@nova", region: "nova", role: "merchant", currency: Number.MAX_SAFE_INTEGER },
        ALICE,
      ),
    );

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(400);
  });

  test("the reported total supply cannot be poisoned by one admit", async () => {
    const node = novaNode();
    node.submit(
      signCommand(
        "acct:alice",
        2,
        { kind: "admit", agentId: "greed@nova", region: "nova", role: "merchant", currency: Number.MAX_SAFE_INTEGER },
        ALICE,
      ),
    );
    const app: Hono = createNodeApp(node);
    const metrics = (await (await app.request("/metrics")).json()) as { agents: { totalCurrency: number } };

    expect(metrics.agents.totalCurrency).toBe(0);
    expect(Number.isSafeInteger(metrics.agents.totalCurrency)).toBe(true);
  });

  test("a transfer amount beyond the ceiling is refused", () => {
    const node = novaNode();
    expect(
      node.submit(signCommand("acct:alice", 2, { kind: "admit", agentId: "ann@nova", region: "nova", role: "merchant" }, ALICE)).ok,
    ).toBe(true);
    expect(
      node.submit(signCommand("acct:alice", 3, { kind: "admit", agentId: "bo@nova", region: "nova", role: "merchant" }, ALICE)).ok,
    ).toBe(true);
    expect(node.register(signRegister("ann@nova", 0, keypair(4))).ok).toBe(true);

    const res = node.submit(
      signCommand("ann@nova", 1, { kind: "transfer", from: "ann@nova", to: "bo@nova", amount: Number.MAX_SAFE_INTEGER }, keypair(4)),
    );
    expect(res.ok).toBe(false);
  });
});

describe("write surface — the bounds do not break the past", () => {
  // The bounds live on the WRITE path (the engine's mutators and the node's schemas).
  // Replay goes through reducers, which is a different path on purpose: a journal
  // written before these bounds existed still has to boot, or a node that took an
  // oversized write yesterday could never start again. This is the guarantee that
  // makes the bounds safe to add to a live node.
  test("a journal holding an over-length region id still replays", () => {
    const oversized = "z".repeat(MAX_REGION_LENGTH + 50);
    const legacy: AlmaEvent[] = [
      {
        type: "region.founded",
        seq: 0,
        tick: 0,
        actor: "world",
        payload: {
          region: {
            id: oversized,
            displayName: "written before the bounds existed",
            institutions: {
              schemaLedger: [],
              verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: true },
              diplomacyPolicy: { defaultStance: "reexamine", overrides: {} },
              governance: { kind: "dictatorship" },
              economyPolicy: { baseCostRate: 0.2, minCostRate: 0.05, repDiscount: 0.02, creditPerTx: 1 },
              resourcePolicy: { capacity: 0, regenPerTick: 0 },
            },
          },
          proposer: { kind: "experimenter" },
          status: "unrecognized",
          owner: "acct:someone",
        },
      } as unknown as AlmaEvent,
    ];

    const journal = new MemoryJournal();
    journal.append(legacy);
    const node = new VouchNode({ seed: "l", notary: keypair(7), journal, accountLog: new MemoryAccountLog() });

    // It booted, and the region is there.
    expect(node.world.log.length).toBe(1);
    const regions = node.world.getState().regions;
    expect(Object.keys(regions)).toContain(oversized);
  });
});
