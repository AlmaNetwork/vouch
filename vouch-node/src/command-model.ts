// RFC 0007 §4 — the command definition MODEL (vouch-node's meaning over vouch-world's opaque
// definition body). vouch-world stores a definition as a frozen `body` it never reads; here we
// give that body a typed shape: a payload schema, a CLOSED precondition vocabulary (§4.2), and
// a CLOSED effect vocabulary (§3.4). "Closed" is load-bearing (P2 — the vocabulary of state
// change is a fixed set): arbitrary expressions cannot be written, only these ops/checks.
//
// A reference is a string beginning with `$`: `$.field` (a payload field), `$actor` / `$tick`
// (execution context). Anything else is a literal. Resolution is data, not code (P1/P2) — the
// interpreter evaluates it (interpreter.ts).

import { z } from "zod";

/** A value that is either a literal number or a reference/number-carrying string. */
const numeric = z.union([z.string(), z.number()]);

// --- §4.2 closed precondition vocabulary (minimal subset) ---------------------
const preconditionSchema = z.discriminatedUnion("check", [
  // the actor IS the referenced id (you may only act as yourself)
  z.object({ check: z.literal("isSelf"), id: z.string() }),
  // an agent's balance in `asset` is >= amount
  z.object({ check: z.literal("balanceAtLeast"), id: z.string(), asset: z.enum(["currency", "credit"]), amount: numeric }),
  // the referenced id owns the referenced region
  z.object({ check: z.literal("isRegionOwner"), region: z.string(), id: z.string() }),
  // world tick has reached at least `tick`
  z.object({ check: z.literal("tickAfter"), tick: numeric }),
]);

// --- §3.4 closed effect vocabulary (the primitives already wired in vouch-world) ---
const effectSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("transfer"), from: z.string(), to: z.string(), amount: numeric }),
  z.object({ op: z.literal("recordVouch"), from: z.string(), to: z.string(), weight: numeric }),
  z.object({ op: z.literal("suspendId"), id: z.string(), untilTick: numeric }),
  z.object({ op: z.literal("reinstateId"), id: z.string() }),
]);

/**
 * The typed body of a `kind: "command"` definition. `payloadSchema` is carried but NOT yet
 * enforced in this skeleton (full JSON-Schema validation of the payload is a follow-up); a
 * missing `$.field` surfaces at effect time as a clean primitive-level reason.
 *
 * STRICT object, REQUIRED preconditions, EXACTLY ONE effect — all three are load-bearing:
 *   - strictObject: a non-strict schema silently DROPS unknown keys, so a one-character typo
 *     (`precondtions`) would parse as a definition with no authority checks at all — the
 *     command executes for anyone and nothing anywhere reports a problem.
 *   - no `.default([])`: an author who wants no preconditions must write `preconditions: []`
 *     explicitly — the honest way to say "deliberately unguarded", never a typo's side effect.
 *   - `.max(1)`: the interpreter cannot roll back — multi-effect all-or-nothing needs the §5
 *     log transaction boundary in vouch-world — so the schema must not ADMIT a shape whose
 *     RFC §3.4/§3.8 atomicity it cannot honour. A 2-effect definition failing on effect 2
 *     would leave effect 1 committed while reporting failure. Lift the cap when §5 lands.
 *     (The seeded `core.*` definitions are single-effect; a validate-before-emit primitive is
 *     atomic on its own.)
 */
export const commandBodySchema = z.strictObject({
  payloadSchema: z.record(z.string(), z.unknown()).optional(),
  preconditions: z.array(preconditionSchema),
  effects: z.array(effectSchema).min(1).max(1),
});

export type CommandBody = z.infer<typeof commandBodySchema>;
export type Precondition = z.infer<typeof preconditionSchema>;
export type Effect = z.infer<typeof effectSchema>;
