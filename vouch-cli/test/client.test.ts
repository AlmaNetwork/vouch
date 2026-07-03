import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { keyPairFromSeed } from "vouch-core";
import { VouchClient } from "../src/client";
import { bootNode } from "./helpers";

const PORT = 8795;
let base: string;
let stop: () => void;

beforeAll(() => {
  const n = bootNode(PORT);
  base = n.base;
  stop = n.stop;
});
afterAll(() => stop());

const clientFor = (seedByte: number) => new VouchClient(base, keyPairFromSeed(new Uint8Array(32).fill(seedByte)));

describe("VouchClient — non-custodial SDK", () => {
  test("account is unregistered until you register, then nonce tracks the node", async () => {
    const alice = clientFor(1);
    expect((await alice.account("alice")).registered).toBe(false);
    expect((await alice.account("alice")).nonce).toBe(-1);
    expect((await alice.register("alice")).ok).toBe(true);
    const acct = await alice.account("alice");
    expect(acct.registered).toBe(true);
    expect(acct.nonce).toBe(0);
  });

  test("submit reads the nonce from the node and advances it", async () => {
    const alice = clientFor(1); // already registered "alice" above
    const found = await alice.found("alice", "cliville", "CLIville");
    expect(found.ok).toBe(true);
    expect((await alice.account("alice")).nonce).toBe(1);
  });

  test("submitting as an unregistered principal is a clear error", async () => {
    const ghost = clientFor(5);
    await expect(ghost.transfer("ghost", "x@cliville", 1)).rejects.toThrow(/not registered/);
  });

  test("found → owner-admits-join → transfer → vouch, conserved", async () => {
    const alice = clientFor(1); // owner of cliville
    const bob = clientFor(2);
    await bob.register("bob@cliville");

    expect((await alice.admit("alice", "bob@cliville", "cliville", "merchant", 50)).ok).toBe(true);
    expect((await alice.admit("alice", "market@cliville", "cliville", "broker", 0)).ok).toBe(true);

    expect((await bob.transfer("bob@cliville", "market@cliville", 20)).ok).toBe(true);
    expect((await bob.vouch("bob@cliville", "market@cliville", 3)).ok).toBe(true);

    const agents = (await alice.agents()) as Array<{ id: string; region: string; balances: { currency: number }; trust: number }>;
    const cliville = agents.filter((a) => a.region === "cliville");
    expect(cliville.reduce((n, a) => n + a.balances.currency, 0)).toBe(50);
    expect(cliville.find((a) => a.id === "bob@cliville")?.balances.currency).toBe(30);
    expect(cliville.find((a) => a.id === "market@cliville")?.trust).toBe(3);
  });

  test("reads work without a key", async () => {
    const anon = new VouchClient(base); // no key
    expect(Array.isArray(await anon.regions())).toBe(true);
    expect(() => anon.publicKey).toThrow(/needs a key/);
  });
});
