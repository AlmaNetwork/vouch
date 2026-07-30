// RFC 0007 §3.7/§4.6 — the genesis seed of `core.*` command definitions, written into the log
// as data. This is the whole point of the data-defined system: `core.transfer` and `core.vouch`
// express, AS DATA, exactly what the hardcoded `dispatch` switch does in code — same authority
// check (isSelf on `from`), same effect (the vouch-world primitive). Once seeded, the runnable
// command set is reproducible state (P1), not a code branch.

import type { DefinitionRecord } from "vouch-world/definition";
import { type PutDefinitionResult, putDefinition, type WorldState } from "vouch-world/environment";
import type { World } from "vouch-world/foundation";

/** `core.transfer` — move currency from `$.from` (must be the actor) to `$.to`. */
export const CORE_TRANSFER: DefinitionRecord = {
  kind: "command",
  id: "core.transfer",
  version: 1,
  status: "active",
  body: {
    preconditions: [{ check: "isSelf", id: "$.from" }],
    effects: [{ op: "transfer", from: "$.from", to: "$.to", amount: "$.amount" }],
  },
};

/** `core.vouch` — `$.from` (the actor) vouches for `$.to` with `$.weight`. */
export const CORE_VOUCH: DefinitionRecord = {
  kind: "command",
  id: "core.vouch",
  version: 1,
  status: "active",
  body: {
    preconditions: [{ check: "isSelf", id: "$.from" }],
    effects: [{ op: "recordVouch", from: "$.from", to: "$.to", weight: "$.weight" }],
  },
};

export const CORE_DEFINITIONS: readonly DefinitionRecord[] = [CORE_TRANSFER, CORE_VOUCH];

/**
 * Seed the `core.*` command definitions into a world. Idempotent only at v1 — calling twice
 * is rejected by putDefinition's monotonic-version guard (a second seed would need v2), which
 * is why the boot path seeds once. Returns each put's result so a caller can assert success.
 */
export function seedCoreDefinitions(world: World<WorldState>): PutDefinitionResult[] {
  return CORE_DEFINITIONS.map((record) => putDefinition(world, record));
}
