import { describe, expect, test } from "bun:test";
import { encodeBase64 } from "vouch-core";
import { AccountRegistry, MemoryAccountLog } from "../src/accounts";
import { keypair, signCommand, signRegister } from "./helpers";

const cmd = { kind: "vouch", from: "acct:alice", to: "acct:bob", weight: 3 };

describe("AccountRegistry — registration (unforgeable identity)", () => {
  test("accepts a valid self-signed registration", () => {
    const reg = new AccountRegistry(new MemoryAccountLog());
    const res = reg.register(signRegister("acct:alice", 0, keypair(1)));
    expect(res.ok).toBe(true);
    expect(reg.has("acct:alice")).toBe(true);
  });

  test("rejects a registration whose signature does not match the supplied key", () => {
    const reg = new AccountRegistry(new MemoryAccountLog());
    const good = signRegister("acct:alice", 0, keypair(1));
    // swap in someone else's public key: possession is no longer proven
    const tampered = { ...good, publicKey: encodeBase64(keypair(2).publicKey) };
    const res = reg.register(tampered);
    expect(res).toMatchObject({ ok: false, status: 401 });
  });

  test("cannot register the reserved system principal", () => {
    const reg = new AccountRegistry(new MemoryAccountLog());
    const res = reg.register(signRegister("world", 0, keypair(1)));
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  test("first registration wins — a second principal claim is refused", () => {
    const reg = new AccountRegistry(new MemoryAccountLog());
    expect(reg.register(signRegister("acct:alice", 0, keypair(1))).ok).toBe(true);
    const res = reg.register(signRegister("acct:alice", 1, keypair(2))); // attacker's key
    expect(res).toMatchObject({ ok: false, status: 409 });
  });
});

describe("AccountRegistry — command verification (signature + replay)", () => {
  test("accepts a command signed by the registered key", () => {
    const reg = new AccountRegistry(new MemoryAccountLog());
    reg.register(signRegister("acct:alice", 0, keypair(1)));
    const res = reg.verify(signCommand("acct:alice", 1, cmd, keypair(1)));
    expect(res).toMatchObject({ ok: true, principal: "acct:alice" });
  });

  test("rejects an unregistered principal", () => {
    const reg = new AccountRegistry(new MemoryAccountLog());
    const res = reg.verify(signCommand("acct:ghost", 1, cmd, keypair(9)));
    expect(res).toMatchObject({ ok: false, status: 401 });
  });

  test("rejects a forged signature (right principal, wrong key)", () => {
    const reg = new AccountRegistry(new MemoryAccountLog());
    reg.register(signRegister("acct:alice", 0, keypair(1)));
    const forged = signCommand("acct:alice", 1, cmd, keypair(2)); // attacker signs as alice
    const res = reg.verify(forged);
    expect(res).toMatchObject({ ok: false, status: 401, reason: "bad-signature" });
  });

  test("rejects a replayed / non-increasing nonce", () => {
    const reg = new AccountRegistry(new MemoryAccountLog());
    reg.register(signRegister("acct:alice", 0, keypair(1)));
    expect(reg.verify(signCommand("acct:alice", 1, cmd, keypair(1))).ok).toBe(true);
    const replay = reg.verify(signCommand("acct:alice", 1, cmd, keypair(1))); // same nonce again
    expect(replay).toMatchObject({ ok: false, status: 401, reason: "stale-nonce" });
  });

  test("the registry rebuilds from its persisted log (key + last nonce survive)", () => {
    const log = new MemoryAccountLog();
    const reg = new AccountRegistry(log);
    reg.register(signRegister("acct:alice", 0, keypair(1)));
    reg.verify(signCommand("acct:alice", 5, cmd, keypair(1)));

    const rebuilt = new AccountRegistry(log); // fresh registry, same log
    expect(rebuilt.has("acct:alice")).toBe(true);
    // nonce 5 was consumed, so 5 (and below) must now be rejected as stale
    expect(rebuilt.verify(signCommand("acct:alice", 5, cmd, keypair(1)))).toMatchObject({ ok: false, reason: "stale-nonce" });
    expect(rebuilt.verify(signCommand("acct:alice", 6, cmd, keypair(1))).ok).toBe(true);
  });
});
