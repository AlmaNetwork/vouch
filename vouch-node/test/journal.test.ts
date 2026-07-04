import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AlmaEvent } from "vouch-world/foundation";
import { FileJournal, MemoryJournal } from "../src/journal";

const dirs: string[] = [];
function tmpFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "vouch-journal-"));
  dirs.push(dir);
  return join(dir, name);
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const events: AlmaEvent[] = [
  { seq: 0, tick: 0, type: "region.founded", actor: "world", payload: { region: { id: "nova" } } },
  { seq: 1, tick: 0, type: "agent.admitted", actor: "world", payload: { id: "ann@nova" } },
];

describe("FileJournal", () => {
  test("append then load round-trips events in order", () => {
    const path = tmpFile("events.jsonl");
    const j = new FileJournal(path);
    j.append(events);
    expect(j.load()).toEqual(events);
  });

  test("appends accumulate across calls; a fresh instance reads them all", () => {
    const path = tmpFile("events.jsonl");
    new FileJournal(path).append([events[0] as AlmaEvent]);
    new FileJournal(path).append([events[1] as AlmaEvent]);
    expect(new FileJournal(path).load()).toEqual(events);
  });

  test("appending nothing writes nothing; loading a missing file is empty", () => {
    const path = tmpFile("events.jsonl");
    const j = new FileJournal(path);
    expect(j.load()).toEqual([]);
    j.append([]);
    expect(j.load()).toEqual([]);
  });
});

describe("FileJournal — crash tolerance", () => {
  test("a torn final line (interrupted append) is dropped, earlier events survive", () => {
    const path = tmpFile("events.jsonl");
    const j = new FileJournal(path);
    j.append(events);
    appendFileSync(path, '{"seq":2,"tick":0,"type":"agent.adm'); // partial write, no newline
    const loaded = j.load();
    expect(loaded).toEqual(events); // the torn tail is gone; boot still works
  });

  test("a malformed INTERIOR line is real corruption and throws", () => {
    const path = tmpFile("events.jsonl");
    appendFileSync(path, `{"broken":\n${JSON.stringify(events[0])}\n`); // bad line is NOT last
    expect(() => new FileJournal(path).load()).toThrow(/corrupt JSONL/);
  });
});

describe("FileJournal — hash-chain tamper-evidence", () => {
  test("a hand-edited event line is rejected on load (chain broken)", () => {
    const path = tmpFile("events.jsonl");
    new FileJournal(path).append(events);
    // tamper: change the first persisted line's event payload, leave its stored hash
    const lines = readFileSync(path, "utf8").trim().split("\n");
    const first = JSON.parse(lines[0] as string) as { event: AlmaEvent; hash: string };
    lines[0] = JSON.stringify({ ...first, event: { ...first.event, payload: { region: { id: "EVIL" } } } });
    writeFileSync(path, `${lines.join("\n")}\n`);
    expect(() => new FileJournal(path).load()).toThrow(/hash-chain broken/);
  });

  test("reordering two lines is detected", () => {
    const path = tmpFile("events.jsonl");
    new FileJournal(path).append(events);
    const [a, b] = readFileSync(path, "utf8").trim().split("\n");
    writeFileSync(path, `${b}\n${a}\n`); // swap
    expect(() => new FileJournal(path).load()).toThrow(/hash-chain broken/);
  });

  test("a clean chain round-trips and survives a fresh instance", () => {
    const path = tmpFile("events.jsonl");
    new FileJournal(path).append(events);
    expect(new FileJournal(path).load()).toEqual(events); // no throw, exact events back
  });

  test("a chained line downgraded to a bare (un-chained) line is rejected", () => {
    const path = tmpFile("events.jsonl");
    new FileJournal(path).append(events); // two chained lines
    const lines = readFileSync(path, "utf8").trim().split("\n");
    // strip the {event,hash} wrapper off the 2nd line to make it look "legacy"
    const wrapped = JSON.parse(lines[1] as string) as { event: AlmaEvent };
    lines[1] = JSON.stringify(wrapped.event);
    writeFileSync(path, `${lines.join("\n")}\n`);
    expect(() => new FileJournal(path).load()).toThrow(/un-chained line/);
  });

  test("a bare (un-chained) line is rejected — no trusted legacy format to downgrade into", () => {
    const path = tmpFile("events.jsonl");
    appendFileSync(path, `${JSON.stringify(events[0])}\n`); // a bare AlmaEvent, not { event, hash }
    expect(() => new FileJournal(path).load()).toThrow(/un-chained line/);
  });

  test("a line whose 'event' is not a real AlmaEvent is rejected (no garbage injection)", () => {
    const path = tmpFile("events.jsonl");
    appendFileSync(path, `${JSON.stringify({ event: "not-an-event", hash: "whatever" })}\n`);
    expect(() => new FileJournal(path).load()).toThrow(/un-chained line/);
  });

  test("a record with extra keys around {event,hash} is rejected (no ChainLine spoofing)", () => {
    const path = tmpFile("events.jsonl");
    const craft = { seq: 0, tick: 0, type: "x", actor: "world", payload: {}, event: events[0], hash: "h" };
    appendFileSync(path, `${JSON.stringify(craft)}\n`);
    expect(() => new FileJournal(path).load()).toThrow(/un-chained line/);
  });
});

describe("MemoryJournal", () => {
  test("append then load round-trips", () => {
    const j = new MemoryJournal();
    j.append(events);
    expect(j.load()).toEqual(events);
  });
});
