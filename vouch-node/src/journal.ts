// The durable event journal — the node's persistence.
//
// The engine's event log is the single source of truth, but it lives in memory.
// This journal writes every emitted event to append-only storage as JSON Lines,
// so a restarted node can `rehydrateAlmaWorld` its full state (see node.ts).
//
// Tamper-evidence: each line carries a hash that CHAINS to the previous line —
// `hash = sha256(canonicalBytes({ prev, event }))`. On boot the whole chain is
// re-folded and verified, so editing, reordering, inserting, or truncating-in-the-
// middle a persisted line is detected and refuses to boot. (Backward compatible:
// legacy un-chained lines written before this was added are trusted and still
// advance the chain, so later chained lines verify.)
//
// Scope of the guarantee: the chain detects PARTIAL tampering. It does NOT stop an
// attacker who can rewrite the whole file AND recompute every hash — that needs an
// external anchor (e.g. the notary signing the chain tip / a checkpoint), which is a
// tracked follow-up. The engine's write-time invariants (unforgeable SYSTEM_ACTOR,
// conservation) are unaffected either way.

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

function isChainLine(v: unknown): v is ChainLine {
  return typeof v === "object" && v !== null && "hash" in v && "event" in v;
}

/** The chain link: sha256 (hex) over the canonical bytes of `{ prev, event }`. */
function linkHash(prev: string, event: AlmaEvent): string {
  return createHash("sha256").update(canonicalBytes({ prev, event })).digest("hex");
}

/** File-backed JSON Lines journal — hash-chained, appended durably (fsync). */
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

  /** Re-fold + verify the on-disk chain; returns the events and the chain tip. */
  private foldChain(): { events: AlmaEvent[]; tip: string } {
    const raw = loadJsonl<unknown>(this.path);
    let prev = "";
    const events: AlmaEvent[] = [];
    for (const [i, line] of raw.entries()) {
      if (isChainLine(line)) {
        const expected = linkHash(prev, line.event);
        if (line.hash !== expected) {
          throw new Error(`journal: hash-chain broken at line ${i + 1} — the log has been tampered with or reordered`);
        }
        prev = line.hash;
        events.push(line.event);
      } else {
        const event = line as AlmaEvent; // legacy bare-event line (written before hash-chaining)
        prev = linkHash(prev, event);
        events.push(event);
      }
    }
    return { events, tip: prev };
  }
}
