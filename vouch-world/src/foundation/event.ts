// Foundation B event log — the event record.
//
// An event is an immutable FACT: "at tick T, actor A did/caused something of
// kind `type` with this `payload`". The log of all events is the single source
// of truth for the world (§3 Foundation B); every state is derivable by folding events.

export const SYSTEM_ACTOR = "world";

/** Emitted by the engine itself when discrete time advances. */
export const EVENT_TICK = "system.tick";

export interface AlmaEvent {
  /** Global, 0-based, monotonically increasing position in the log. */
  readonly seq: number;
  /**
   * Discrete sim-engine time at which this event happened. SIMULATION annotation
   * (audit G5): the protocol orders by `seq`, not `tick`. Higher layers (region,
   * future economy) must NOT read `tick` as canonical/wall-clock time.
   */
  readonly tick: number;
  /** Event kind. */
  readonly type: string;
  /** Who caused it (the originating subject): an identifier string, or SYSTEM_ACTOR for the engine. */
  readonly actor: string;
  /** Event content. Opaque to the log; meaning belongs to higher layers. */
  readonly payload: Readonly<Record<string, unknown>>;
}
