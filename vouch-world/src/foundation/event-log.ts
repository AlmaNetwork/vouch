// Foundations B event log — append-only log. The single source of truth (§3).
//
// Only `append` mutates the log. Stored events are deep-frozen, and readers get
// a copy, so a once-written event can never be changed or removed (§M1).

import type { AlmaEvent } from "./event";
import { deepFreeze, fnv1a, stableStringify } from "./util";

/**
 * Read-only view of an event log (audit G1). This is what the World exposes as
 * `world.log`, and what the M5 observation layer will consume — it has every
 * reader but NO `append`, so the reducer-via-emit path is the ONLY way into the
 * canonical log (no silent reducer-bypass write).
 */
export interface WorldLog {
  readonly length: number;
  all(): AlmaEvent[];
  at(seq: number): AlmaEvent | undefined;
  since(seq: number): AlmaEvent[];
  digest(): string;
}

export class EventLog {
  private readonly events: AlmaEvent[] = [];

  /** Append a new event. `seq` is assigned here; the stored event is frozen. */
  append(input: Omit<AlmaEvent, "seq">): AlmaEvent {
    const event = deepFreeze<AlmaEvent>({
      seq: this.events.length,
      tick: input.tick,
      type: input.type,
      actor: input.actor,
      payload: input.payload,
    });
    this.events.push(event);
    return event;
  }

  get length(): number {
    return this.events.length;
  }

  /** A copy of the full log — callers cannot push into the source of truth. */
  all(): AlmaEvent[] {
    return [...this.events];
  }

  at(seq: number): AlmaEvent | undefined {
    return this.events[seq];
  }

  since(seq: number): AlmaEvent[] {
    return this.events.slice(seq);
  }

  /** Order-independent content fingerprint, for comparing two histories. */
  digest(): string {
    return fnv1a(stableStringify(this.events));
  }

  /** A read-only facade over this log: all readers, no `append` (audit G1). */
  asReadOnly(): WorldLog {
    const log = this;
    return {
      get length() {
        return log.length;
      },
      all: () => log.all(),
      at: (seq) => log.at(seq),
      since: (seq) => log.since(seq),
      digest: () => log.digest(),
    };
  }
}
