import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeyPair } from "vouch-core";
import { getAgent } from "vouch-world/agent";
import { assertCurrencyConserved } from "vouch-world/environment";
import { FileAccountLog, MemoryAccountLog } from "../src/accounts";
import { FileJournal, MemoryJournal } from "../src/journal";
import { VouchNode } from "../src/node";
import { keypair, signCommand, signRegister } from "./helpers";

const NOTARY: KeyPair = keypair(7);
const ALICE = keypair(1);
const ANN = keypair(3);

const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "vouch-node-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function freshNode(): VouchNode {
  return new VouchNode({ seed: "n", notary: NOTARY, journal: new MemoryJournal(), accountLog: new MemoryAccountLog() });
}

/** Register alice + found "nova" + admit two residents on the given node. */
function setUpNova(node: VouchNode) {
  node.register(signRegister("acct:alice", 0, ALICE));
  node.register(signRegister("ann@nova", 0, ANN));
  expect(node.submit(signCommand("acct:alice", 1, { kind: "found", regionId: "nova", displayName: "Nova" }, ALICE)).ok).toBe(true);
  expect(
    node.submit(
      signCommand("acct:alice", 2, { kind: "admit", agentId: "ann@nova", region: "nova", role: "merchant", currency: 100 }, ALICE),
    ).ok,
  ).toBe(true);
  expect(
    node.submit(signCommand("acct:alice", 3, { kind: "admit", agentId: "bo@nova", region: "nova", role: "merchant", currency: 0 }, ALICE))
      .ok,
  ).toBe(true);
}

describe("VouchNode — durability (replay-on-boot)", () => {
  test("a restarted node recovers full state from its journal + auth log", () => {
    const dir = tmpDir();
    const ev = join(dir, "events.jsonl");
    const acc = join(dir, "accounts.jsonl");
    const boot = () => new VouchNode({ seed: "n", notary: NOTARY, journal: new FileJournal(ev), accountLog: new FileAccountLog(acc) });

    const node1 = boot();
    setUpNova(node1);
    expect(node1.submit(signCommand("ann@nova", 1, { kind: "transfer", from: "ann@nova", to: "bo@nova", amount: 20 }, ANN)).ok).toBe(true);
    expect(node1.submit(signCommand("ann@nova", 2, { kind: "vouch", from: "ann@nova", to: "bo@nova", weight: 3 }, ANN)).ok).toBe(true);
    const digest = node1.world.log.digest();
    const state = JSON.stringify(node1.world.getState());

    // "restart" — a brand-new node pointed at the same files
    const node2 = boot();
    expect(node2.world.log.digest()).toBe(digest);
    expect(JSON.stringify(node2.world.getState())).toBe(state);
    expect(getAgent(node2.world.getState(), "ann@nova")?.balances.currency).toBe(80); // 100 - 20 (sender pays amount)
    expect(getAgent(node2.world.getState(), "bo@nova")?.trust).toBeGreaterThan(0);
    expect(() => assertCurrencyConserved(node2.world)).not.toThrow();

    // and it keeps working: nonces + world state carried over, so a fresh command applies
    expect(node2.submit(signCommand("ann@nova", 3, { kind: "transfer", from: "ann@nova", to: "bo@nova", amount: 5 }, ANN)).ok).toBe(true);
    expect(getAgent(node2.world.getState(), "ann@nova")?.balances.currency).toBe(75);
    // node1 (stale, in-memory) never saw that write — proof state came from disk, not a shared object
    expect(getAgent(node1.world.getState(), "ann@nova")?.balances.currency).toBe(80);
  });
});

describe("VouchNode — authorization & integrity", () => {
  test("an unregistered principal is rejected (401)", () => {
    const node = freshNode();
    const res = node.submit(signCommand("acct:ghost", 1, { kind: "found", regionId: "x", displayName: "X" }, keypair(9)));
    expect(res).toMatchObject({ ok: false, status: 401 });
  });

  test("a forged signature is rejected (401)", () => {
    const node = freshNode();
    node.register(signRegister("acct:alice", 0, ALICE));
    const forged = signCommand("acct:alice", 1, { kind: "found", regionId: "x", displayName: "X" }, keypair(2));
    expect(node.submit(forged)).toMatchObject({ ok: false, status: 401, reason: "bad-signature" });
  });

  test("the reserved system principal can neither register nor act", () => {
    const node = freshNode();
    expect(node.register(signRegister("world", 0, keypair(5)))).toMatchObject({ ok: false, status: 400 });
    expect(node.submit(signCommand("world", 1, { kind: "found", regionId: "x", displayName: "X" }, keypair(5)))).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  test("a replayed nonce is rejected (401)", () => {
    const node = freshNode();
    setUpNova(node);
    expect(node.submit(signCommand("acct:alice", 2, { kind: "found", regionId: "z", displayName: "Z" }, ALICE))).toMatchObject({
      ok: false,
      reason: "stale-nonce",
    });
  });

  test("only the region owner may admit (422 otherwise)", () => {
    const node = freshNode();
    setUpNova(node);
    node.register(signRegister("acct:mallory", 0, keypair(6)));
    const res = node.submit(
      signCommand("acct:mallory", 1, { kind: "admit", agentId: "eve@nova", region: "nova", role: "merchant" }, keypair(6)),
    );
    expect(res).toMatchObject({ ok: false, status: 422, reason: "not-region-owner" });
  });

  test("you can only spend from your own account (422 otherwise)", () => {
    const node = freshNode();
    setUpNova(node);
    // ann is the signer but tries to move bo's money
    const res = node.submit(signCommand("ann@nova", 1, { kind: "transfer", from: "bo@nova", to: "ann@nova", amount: 5 }, ANN));
    expect(res).toMatchObject({ ok: false, status: 422, reason: "not-sender" });
  });

  test("a malformed command is rejected (400) and does not consume the nonce", () => {
    const node = freshNode();
    node.register(signRegister("acct:alice", 0, ALICE));
    expect(node.submit(signCommand("acct:alice", 1, { kind: "nonsense" }, ALICE))).toMatchObject({ ok: false, status: 400 });
    // nonce 1 was NOT consumed, so a valid command at nonce 1 still works
    expect(node.submit(signCommand("acct:alice", 1, { kind: "found", regionId: "nova", displayName: "Nova" }, ALICE)).ok).toBe(true);
  });
});
