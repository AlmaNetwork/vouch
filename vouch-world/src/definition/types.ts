// The versioned definition store (RFC 0007 §4) — data-defined commands live in the log.
//
// FORM vs MEANING (the vouch-core discipline, one layer up): vouch-world stores a definition
// as an OPAQUE, validated ENVELOPE — kind/id/version/status + a frozen `body` object it never
// interprets. What the body MEANS (payloadSchema, preconditions, effects) is vouch-node's
// business, exactly as a certificate's `claims` are meaning-free to vouch-core. The engine
// stores and version-checks; it never reads inside `body`.
//
// P1 self-description / P6 determinism: definitions are events in the log, so replay
// reconstructs them and the data-defined command system is reproducible from t0.

export const EVENT_DEFINITION_PUT = "definition.put";

export type DefinitionStatus = "active" | "retired";

/** One version of a definition. A later put of the same id is a NEW version (no shadowing, §4.3). */
export interface DefinitionRecord {
  readonly kind: string; // "command" | "role" | "procedure" | "law" | "preamble" — opaque here
  readonly id: string; // "<namespace>.<name>", unique
  readonly version: number; // monotonic per id (1, then +1 each put)
  readonly status: DefinitionStatus;
  readonly body: Readonly<Record<string, unknown>>; // opaque; interpreted above (form vs meaning)
}

/** The definition read-model slice: id -> its CURRENT (latest) version record. */
export type DefinitionSlice = { readonly definitions: Readonly<Record<string, DefinitionRecord>> };

export type DefinitionPutPayload = { readonly record: DefinitionRecord };

/** Maps the definition event type to its payload — keys the environment's typed `commit`. */
export interface DefinitionEventMap {
  [EVENT_DEFINITION_PUT]: DefinitionPutPayload;
}
