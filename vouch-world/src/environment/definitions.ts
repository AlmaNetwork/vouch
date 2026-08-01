// Layer 4 Environment — the definition-store write path (RFC 0007 §4 / putDefinition).
//
// vouch-world stores a definition as an OPAQUE envelope (form); vouch-node interprets the
// body (meaning). This op validates only the ENVELOPE — id grammar, reserved namespace,
// monotonic version, status, kind, body-is-object — then commits one SYSTEM-authored
// definition.put event. It NEVER looks inside `body`.

import { type DefinitionRecord, EVENT_DEFINITION_PUT, getDefinition } from "../definition";
import type { Result } from "../foundation";
import { commit, type WorldCommit } from "./state";

export type PutDefinitionResult = Result<{ id: string; version: number }>;

// "<namespace>.<name>[.name…]" — a lowercase-initial namespace then one or more dotted
// segments. Matches core.transfer / core.defineCommand / scholarship.grant / role.auditor.
const DEFINITION_ID = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/;

/**
 * Write (or version-bump) a definition. `kernel.*` is reserved (unenactable, §4.3). A new id
 * must arrive at version 1; an existing id must arrive at exactly current+1 (§4.3: redefining
 * an id is always a NEW version — no shadowing, no gaps). Envelope-only validation; the body
 * is opaque. Returns a reason on rejection, never throws (the environment's Result discipline).
 */
export function putDefinition(env: WorldCommit, record: DefinitionRecord): PutDefinitionResult {
  if (!DEFINITION_ID.test(record.id)) return { ok: false, reason: "bad-definition-id" };
  if (record.id.startsWith("kernel.")) return { ok: false, reason: "reserved-namespace" };
  if (typeof record.kind !== "string" || record.kind.length === 0) return { ok: false, reason: "bad-kind" };
  if (record.status !== "active" && record.status !== "retired") return { ok: false, reason: "bad-status" };
  if (typeof record.body !== "object" || record.body === null || Array.isArray(record.body)) return { ok: false, reason: "bad-body" };
  if (!Number.isInteger(record.version) || record.version < 1) return { ok: false, reason: "bad-version" };
  const current = getDefinition(env.getState(), record.id);
  const expected = current ? current.version + 1 : 1;
  if (record.version !== expected) return { ok: false, reason: "non-monotonic-version" };
  commit(env, EVENT_DEFINITION_PUT, { record });
  return { ok: true, id: record.id, version: record.version };
}
