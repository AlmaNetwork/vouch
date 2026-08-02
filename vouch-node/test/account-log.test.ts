// The auth log is hash-chained, for a sharper reason than the journal is.
//
// This file holds every principal's nonce, and the nonce is the only thing standing
// between a captured request and a replay of it — the signature on an old command was
// always valid, the counter is what refuses it. Rewind one and the command works again.

import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AuthLine, FileAccountLog, MemoryAccountLog } from "../src/account-log";
import { AccountRegistry } from "../src/accounts";
import { keypair, signCommand, signRegister } from "./helpers";

const dirs: string[] = [];
function tmpFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "vouch-authlog-"));
  dirs.push(dir);
  return join(dir, name);
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const lines: AuthLine[] = [
  { kind: "register", principal: "acct:alice", publicKey: "cHVibGlj", nonce: 0 },
  { kind: "nonce", principal: "acct:alice", nonce: 1 },
  { kind: "nonce", principal: "acct:alice", nonce: 2 },
];

/** Rewrite the file from a list of already-decoded chained entries. */
function writeRaw(path: string, entries: unknown[]): void {
  writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
}
function readRaw(path: string): { line: AuthLine; hash: string }[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

describe("FileAccountLog", () => {
  test("append then load round-trips lines in order", () => {
    const path = tmpFile("accounts.jsonl");
    const log = new FileAccountLog(path);
    for (const l of lines) log.append(l);
    expect(log.load()).toEqual(lines);
  });

  test("a fresh instance picks up the chain and can keep appending", () => {
    const path = tmpFile("accounts.jsonl");
    new FileAccountLog(path).append(lines[0] as AuthLine);
    new FileAccountLog(path).append(lines[1] as AuthLine);
    expect(new FileAccountLog(path).load()).toEqual(lines.slice(0, 2));
  });

  test("loading a missing file is empty", () => {
    expect(new FileAccountLog(tmpFile("accounts.jsonl")).load()).toEqual([]);
  });
});

describe("FileAccountLog — tamper evidence", () => {
  test("editing a nonce is detected", () => {
    const path = tmpFile("accounts.jsonl");
    const log = new FileAccountLog(path);
    for (const l of lines) log.append(l);

    // The attack this exists for: wind a principal's nonce backwards so an old signed
    // command is accepted again.
    const raw = readRaw(path);
    (raw[2] as { line: { nonce: number } }).line.nonce = 0;
    writeRaw(path, raw);

    expect(() => new FileAccountLog(path).load()).toThrow(/hash-chain broken at line 3/);
  });

  test("swapping a registered public key is detected", () => {
    const path = tmpFile("accounts.jsonl");
    const log = new FileAccountLog(path);
    log.append(lines[0] as AuthLine);

    const raw = readRaw(path);
    (raw[0] as { line: { publicKey: string } }).line.publicKey = "YXR0YWNrZXI=";
    writeRaw(path, raw);

    expect(() => new FileAccountLog(path).load()).toThrow(/hash-chain broken at line 1/);
  });

  test("reordering is detected", () => {
    const path = tmpFile("accounts.jsonl");
    const log = new FileAccountLog(path);
    for (const l of lines) log.append(l);

    const raw = readRaw(path);
    writeRaw(path, [raw[0], raw[2], raw[1]]);

    expect(() => new FileAccountLog(path).load()).toThrow(/hash-chain broken/);
  });

  test("deleting an interior line is detected", () => {
    const path = tmpFile("accounts.jsonl");
    const log = new FileAccountLog(path);
    for (const l of lines) log.append(l);

    const raw = readRaw(path);
    writeRaw(path, [raw[0], raw[2]]);

    expect(() => new FileAccountLog(path).load()).toThrow(/hash-chain broken at line 2/);
  });

  // No "legacy, un-chained" line is trusted. Accepting one would hand an attacker the
  // bypass: append whatever you like without a hash and it is waved through.
  test("an un-chained bare line is rejected, not accepted as legacy", () => {
    const path = tmpFile("accounts.jsonl");
    writeFileSync(path, `${JSON.stringify(lines[0])}\n`);

    expect(() => new FileAccountLog(path).load()).toThrow(/malformed or un-chained line at 1/);
  });

  test("a chained line with extra keys is rejected", () => {
    const path = tmpFile("accounts.jsonl");
    new FileAccountLog(path).append(lines[0] as AuthLine);

    const raw = readRaw(path);
    writeRaw(path, [{ ...raw[0], extra: "smuggled" }]);

    expect(() => new FileAccountLog(path).load()).toThrow(/malformed or un-chained/);
  });

  // The journal chain hashes `{prev, event}` and this one `{prev, line}`, so the same
  // record cannot be lifted from one file into the other even at the same position.
  test("a journal entry cannot be passed off as an auth line", () => {
    const path = tmpFile("accounts.jsonl");
    writeRaw(path, [{ event: { type: "region.founded", seq: 0, actor: "world" }, hash: "00" }]);

    expect(() => new FileAccountLog(path).load()).toThrow(/malformed or un-chained/);
  });
});

describe("FileAccountLog — crash tolerance", () => {
  test("a torn final line is dropped; earlier lines survive", () => {
    const path = tmpFile("accounts.jsonl");
    const log = new FileAccountLog(path);
    for (const l of lines) log.append(l);
    appendFileSync(path, '{"line":{"kind":"nonce","princ'); // interrupted append

    expect(new FileAccountLog(path).load()).toEqual(lines);
  });

  test("appending after a torn tail keeps the chain verifiable", () => {
    const path = tmpFile("accounts.jsonl");
    const log = new FileAccountLog(path);
    log.append(lines[0] as AuthLine);
    appendFileSync(path, '{"line":{"kind":"non');

    // A fresh boot drops the tail, re-derives the tip, and carries on from there.
    const reopened = new FileAccountLog(path);
    reopened.load();
    reopened.append(lines[1] as AuthLine);
    expect(new FileAccountLog(path).load()).toEqual(lines.slice(0, 2));
  });
});

describe("the registry on top of it", () => {
  test("a rewound nonce cannot be used to replay an old command", () => {
    const path = tmpFile("accounts.jsonl");
    const alice = keypair(1);

    const first = new AccountRegistry(new FileAccountLog(path));
    expect(first.register(signRegister("acct:alice", 0, alice)).ok).toBe(true);
    const command = signCommand("acct:alice", 5, { kind: "found", regionId: "nova", displayName: "Nova" }, alice);
    expect(first.verify(command).ok).toBe(true);
    expect(first.verify(command).ok).toBe(false); // already spent — the counter refuses it

    // Wind the counter back on disk, which is exactly what a stale restore does.
    const raw = readRaw(path);
    (raw[1] as { line: { nonce: number } }).line.nonce = 0;
    writeRaw(path, raw);

    // Boot now fails loudly instead of coming up with a replay window open.
    expect(() => new AccountRegistry(new FileAccountLog(path))).toThrow(/hash-chain broken/);
  });

  test("an ordinary register/verify cycle still persists across a restart", () => {
    const path = tmpFile("accounts.jsonl");
    const alice = keypair(1);

    const first = new AccountRegistry(new FileAccountLog(path));
    first.register(signRegister("acct:alice", 0, alice));
    first.verify(signCommand("acct:alice", 3, { kind: "found", regionId: "n", displayName: "N" }, alice));

    const rebooted = new AccountRegistry(new FileAccountLog(path));
    expect(rebooted.has("acct:alice")).toBe(true);
    expect(rebooted.nonceOf("acct:alice")).toBe(3);
  });
});

describe("MemoryAccountLog", () => {
  test("round-trips without a chain — there is no on-disk surface to protect", () => {
    const log = new MemoryAccountLog();
    for (const l of lines) log.append(l);
    expect(log.load()).toEqual(lines);
  });
});
