// Shared append-only JSON Lines persistence for the journal and the auth log.
//
// Two properties the durability story needs:
//  - durableAppend fsyncs, so a write we've reported as committed survives a power
//    loss, not just a process crash.
//  - loadJsonl tolerates a torn FINAL line (an append interrupted by a crash): the
//    partial record is dropped and the client retries. A malformed INTERIOR line is
//    real corruption and throws, rather than silently rebuilding a divergent state.
//
// Note: these files are TRUSTED local storage — whoever can write them controls the
// node, as with any database. Both callers hash-chain their own records on top of
// these primitives (journal.ts, account-log.ts), so tampering is DETECTED at boot;
// that makes it evident, not impossible. What chaining cannot see is a rewrite of a
// whole file with every hash recomputed from genesis — nothing outside the file
// commits to its contents. An external anchor is the tracked follow-up.

import { closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Drop a torn final line so the next append starts on a record boundary.
 *
 * Reading past a torn tail was already handled; WRITING past one was not, and that is
 * the damaging half. Appending onto a file that ends mid-record concatenates the new
 * record onto the fragment, producing one malformed line — which `loadJsonl` then drops
 * as the (still) final line. The write is silently lost: the caller was told it
 * committed, `fsync` really did run, and nothing throws. The append after THAT one makes
 * the fragment an INTERIOR malformed line, and the node can never boot again.
 *
 * Truncating is lossless. A record with no terminating newline never had its `fsync`
 * complete, so it was never a write anyone was promised.
 *
 * Returns whether anything was removed.
 */
export function healTornTail(path: string): boolean {
  if (!existsSync(path)) return false;
  const buf = readFileSync(path);
  if (buf.length === 0 || buf[buf.length - 1] === 0x0a) return false; // ends clean

  // Everything up to and including the last newline is whole; the rest is the fragment.
  // No newline at all means the entire file is one interrupted first write.
  const keep = buf.lastIndexOf(0x0a) + 1;
  const fd = openSync(path, "r+");
  try {
    ftruncateSync(fd, keep);
    fsyncSync(fd); // the repair has to survive the next crash too
  } finally {
    closeSync(fd);
  }
  return true;
}

/** Append text durably (fsync), creating the parent directory if needed. */
export function durableAppend(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  // Before writing, not after reading: a node that boots, serves, and only then takes
  // its next write must not append onto a fragment left by the crash it just recovered
  // from. Putting this in the shared primitive covers the journal and the auth log
  // together, and every future caller of it.
  healTornTail(path);
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
