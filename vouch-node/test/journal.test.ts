import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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

describe("MemoryJournal", () => {
  test("append then load round-trips", () => {
    const j = new MemoryJournal();
    j.append(events);
    expect(j.load()).toEqual(events);
  });
});
