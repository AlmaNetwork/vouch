// The durable event journal — the node's persistence.
//
// The engine's event log is the single source of truth, but it lives in memory.
// This journal writes every emitted event to append-only storage as JSON Lines,
// so a restarted node can `rehydrateAlmaWorld` its full state (see node.ts).
//
// Tamper-evidence: every line is `{ event, hash }` where
// `hash = sha256(canonicalBytes({ prev, event }))` chains to the previous line
// (`prev = ""` at genesis). On boot the whole chain is re-folded from genesis and
// verified, so editing, reordering, inserting, or interior-truncating a line is
// detected and refuses to boot. The format is STRICT: a line that isn't exactly a
// well-formed `{ event, hash }` (event a real AlmaEvent, no extra keys) is rejected
// as corrupt — there is no trusted "legacy / un-chained" line to downgrade into.
//
// Scope: the chain anchors every line from genesis, but it does NOT stop an attacker
// who rewrites the WHOLE file AND recomputes every hash from genesis — that needs an
// external anchor (e.g. the notary signing the chain tip / a checkpoint), a tracked
// follow-up. The engine's write-time invariants (unforgeable SYSTEM_ACTOR,
// conservation) are unaffected either way. MemoryJournal keeps no chain (no on-disk
// surface).

import { createHash } from "node:crypto";
import { canonicalBytes } from "vouch-core";
import type { AlmaEvent } from "vouch-world/foundation";
import { durableAppend, loadJsonl } from "./persist";

export interface Journal {
  /** Persist newly-emitted events, in order. */
  append(events: readonly AlmaEvent[]): void;
  /** Load the full log in original order (for replay-on-boot). */
  load(): AlmaEvent[];
}

/** In-memory journal — for tests and ephemeral nodes (no on-disk tamper surface, so no chain). */
export class MemoryJournal implements Journal {
  private readonly events: AlmaEvent[] = [];
  append(events: readonly AlmaEvent[]): void {
    this.events.push(...events);
  }
  load(): AlmaEvent[] {
    return [...this.events];
  }
}

/** A persisted line: the event plus its chain hash. */
type ChainLine = { readonly event: AlmaEvent; readonly hash: string };

/** Minimal structural check that a decoded value is an engine event (not injected garbage). */
function isAlmaEvent(v: unknown): v is AlmaEvent {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.type === "string" && typeof e.seq === "number" && typeof e.actor === "string";
}

/** Decode a line strictly as `{ event, hash }` — exactly those keys, event a real AlmaEvent. */
function asChainLine(v: unknown): ChainLine | null {
  if (typeof v !== "object" || v === null) return null;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes("event") || !keys.includes("hash")) return null;
  const { event, hash } = v as { event: unknown; hash: unknown };
  if (typeof hash !== "string" || !isAlmaEvent(event)) return null;
  return { event, hash };
}

/** The chain link: sha256 (hex) over the canonical bytes of `{ prev, event }`. */
function linkHash(prev: string, event: AlmaEvent): string {
  return createHash("sha256").update(canonicalBytes({ prev, event })).digest("hex");
}

/** File-backed JSON Lines journal — strictly hash-chained, appended durably (fsync). */
export class FileJournal implements Journal {
  private tip: string | null = null; // chain hash of the last persisted event ("" = empty)

  constructor(private readonly path: string) {}

  append(events: readonly AlmaEvent[]): void {
    if (events.length === 0) return;
    let prev = this.tip ?? this.foldChain().tip;
    const lines = events.map((event) => {
      const hash = linkHash(prev, event);
      prev = hash;
      return JSON.stringify({ event, hash } satisfies ChainLine);
    });
    durableAppend(this.path, `${lines.join("\n")}\n`);
    this.tip = prev;
  }

  load(): AlmaEvent[] {
    const { events, tip } = this.foldChain();
    this.tip = tip;
    return events;
  }

  /** Re-fold + verify the whole chain from genesis; returns the events and the chain tip. */
  private foldChain(): { events: AlmaEvent[]; tip: string } {
    const raw = loadJsonl<unknown>(this.path);
    let prev = "";
    const events: AlmaEvent[] = [];
    for (const [i, line] of raw.entries()) {
      const cl = asChainLine(line);
      if (!cl) throw new Error(`journal: malformed or un-chained line at ${i + 1} — the log is corrupt or has been tampered with`);
      if (cl.hash !== linkHash(prev, cl.event)) {
        throw new Error(`journal: hash-chain broken at line ${i + 1} — the log has been tampered with or reordered`);
      }
      prev = cl.hash;
      events.push(cl.event);
    }
    return { events, tip: prev };
  }
}
