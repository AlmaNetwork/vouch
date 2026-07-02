// The durable event journal — the node's persistence.
//
// The engine's event log is the single source of truth, but it lives in memory.
// This journal writes every emitted event to append-only storage as JSON Lines,
// so a restarted node can `rehydrateAlmaWorld` its full state (see node.ts).
// It stores raw AlmaEvents only — nothing derived — so the log stays canonical.

import type { AlmaEvent } from "vouch-world/foundation";
import { durableAppend, loadJsonl } from "./persist";

export interface Journal {
  /** Persist newly-emitted events, in order. */
  append(events: readonly AlmaEvent[]): void;
  /** Load the full log in original order (for replay-on-boot). */
  load(): AlmaEvent[];
}

/** In-memory journal — for tests and ephemeral nodes. */
export class MemoryJournal implements Journal {
  private readonly events: AlmaEvent[] = [];
  append(events: readonly AlmaEvent[]): void {
    this.events.push(...events);
  }
  load(): AlmaEvent[] {
    return [...this.events];
  }
}

/** File-backed JSON Lines journal — one event per line, appended durably (fsync). */
export class FileJournal implements Journal {
  constructor(private readonly path: string) {}

  append(events: readonly AlmaEvent[]): void {
    if (events.length === 0) return;
    durableAppend(this.path, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
  }

  load(): AlmaEvent[] {
    return loadJsonl<AlmaEvent>(this.path);
  }
}
