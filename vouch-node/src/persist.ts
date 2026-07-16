// Shared append-only JSON Lines persistence for the journal and the auth log.
//
// Two properties the durability story needs:
//  - durableAppend fsyncs, so a write we've reported as committed survives a power
//    loss, not just a process crash.
//  - loadJsonl tolerates a torn FINAL line (an append interrupted by a crash): the
//    partial record is dropped and the client retries. A malformed INTERIOR line is
//    real corruption and throws, rather than silently rebuilding a divergent state.
//
// Note: these files are TRUSTED local storage. There is no cryptographic
// tamper-evidence yet — anyone who can write these files controls the node (as with
// any database). Per-line signing / hash-chaining is a tracked hardening follow-up.

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/** Append text durably (fsync), creating the parent directory if needed. */
export function durableAppend(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a");
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Load append-only JSON Lines; drop a torn final line, throw on interior corruption. */
export function loadJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const out: T[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      out.push(JSON.parse(lines[i] as string) as T);
    } catch (e) {
      // Only the last line can be a torn tail from an interrupted append.
      if (i === lines.length - 1) break;
      throw new Error(`corrupt JSONL at ${path} line ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
