// RFC 0007 §3.8 — the command execution pipeline (minimal skeleton).
//
//   resolve the definition (log-stored, data)   … getDefinition
//   → validate/parse its body (closed vocab)     … command-model
//   → evaluate preconditions (data lookups)      … precondition catalog
//   → apply effects (the closed primitive set)   … effect catalog -> vouch-world write path
//
// Every policy decision is a DATA LOOKUP against log-derived state; the kernel merely
// interprets (P1/P2). The effects call the REAL vouch-world primitives, so conservation, the
// event log, and deterministic replay are inherited — this layer adds no new write path.
//
// Deferred (documented in command-model): payloadSchema enforcement, multi-effect atomicity
// (needs a vouch-world tx boundary, lands with §5), Roles/bundles (§4.4), SoD/penal laws.

import type { KeyPair } from "vouch-core";
import { getAgent } from "vouch-world/agent";
import { getDefinition } from "vouch-world/definition";
import { executeTransfer, reinstateAgent, suspendAgent, vouchFor, type WorldState } from "vouch-world/environment";
import type { Result, World } from "vouch-world/foundation";
import { ownerOf } from "vouch-world/region";
import { commandBodySchema, type Effect, type Precondition } from "./command-model";

/** A request to run a data-defined command: which definition, on whose authority, with what input. */
export interface CommandPacket {
  readonly definitionId: string;
  readonly actor: string; // the (already-authenticated) issuing principal
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ExecContext {
  readonly notary: KeyPair;
}

export type ExecResult = Result<{ effects: number }>;

/**
 * Resolve a definition value: `$actor` / `$tick` from context, `$.field` from the payload,
 * anything else is a literal. Data, not code — the closure of the vocabulary is preserved.
 */
function resolve(value: unknown, packet: CommandPacket, tick: number): unknown {
  if (typeof value !== "string" || value.length === 0 || value[0] !== "$") return value;
  if (value === "$actor") return packet.actor;
  if (value === "$tick") return tick;
  if (value.startsWith("$.")) return packet.payload[value.slice(2)];
  return value; // a stray "$…" that matches no reference form is treated as a literal
}

const asString = (v: unknown): string => (typeof v === "string" ? v : String(v));
const asNumber = (v: unknown): number => (typeof v === "number" ? v : Number(v));

// --- §4.2 precondition catalog ------------------------------------------------

/** Evaluate one precondition against log-derived state. Returns true iff satisfied. */
function checkPrecondition(world: World<WorldState>, pre: Precondition, packet: CommandPacket, tick: number): boolean {
  const state = world.getState();
  switch (pre.check) {
    case "isSelf":
      return asString(resolve(pre.id, packet, tick)) === packet.actor;
    case "balanceAtLeast": {
      const agent = getAgent(state, asString(resolve(pre.id, packet, tick)));
      return agent !== undefined && agent.balances[pre.asset] >= asNumber(resolve(pre.amount, packet, tick));
    }
    case "isRegionOwner":
      return ownerOf(state, asString(resolve(pre.region, packet, tick))) === asString(resolve(pre.id, packet, tick));
    case "tickAfter":
      return tick >= asNumber(resolve(pre.tick, packet, tick));
  }
}

// --- §3.4 effect catalog (op -> the real vouch-world primitive) ---------------

/** Apply one effect via the vouch-world write path. Its Result (reason on failure) passes through. */
function applyEffect(world: World<WorldState>, eff: Effect, packet: CommandPacket, ctx: ExecContext, tick: number): Result {
  switch (eff.op) {
    case "transfer":
      return executeTransfer(
        world,
        {
          from: asString(resolve(eff.from, packet, tick)),
          to: asString(resolve(eff.to, packet, tick)),
          amount: asNumber(resolve(eff.amount, packet, tick)),
        },
        { tick, notary: ctx.notary },
      );
    case "recordVouch":
      return vouchFor(
        world,
        asString(resolve(eff.from, packet, tick)),
        asString(resolve(eff.to, packet, tick)),
        asNumber(resolve(eff.weight, packet, tick)),
      );
    case "suspendId":
      // the sanction's authority is the issuing principal (§6 canSanction gates it downstream).
      return suspendAgent(world, asString(resolve(eff.id, packet, tick)), asNumber(resolve(eff.untilTick, packet, tick)), packet.actor);
    case "reinstateId":
      return reinstateAgent(world, asString(resolve(eff.id, packet, tick)), packet.actor);
  }
}

/**
 * Run a data-defined command through the §3.8 pipeline. The definition is read from the log
 * (getDefinition), so the very set of runnable commands is itself reproducible state (P1).
 * Reasons: `unknown-definition`, `definition-retired`, `not-a-command`, `malformed-definition`,
 * `precondition-failed:<check>`, plus any primitive-level reason from an effect.
 */
export function executeCommand(world: World<WorldState>, packet: CommandPacket, ctx: ExecContext): ExecResult {
  const tick = world.tick;
  const record = getDefinition(world.getState(), packet.definitionId);
  if (!record) return { ok: false, reason: "unknown-definition" };
  if (record.status !== "active") return { ok: false, reason: "definition-retired" };
  if (record.kind !== "command") return { ok: false, reason: "not-a-command" };

  const parsed = commandBodySchema.safeParse(record.body);
  if (!parsed.success) return { ok: false, reason: "malformed-definition" };
  const body = parsed.data;

  // preconditions — all must hold before ANY effect runs (§3.8: the check precedes the apply).
  for (const pre of body.preconditions) {
    if (!checkPrecondition(world, pre, packet, tick)) return { ok: false, reason: `precondition-failed:${pre.check}` };
  }

  // effects — applied in order. Seeded commands are single-effect (atomic by construction);
  // multi-effect all-or-nothing awaits a vouch-world tx boundary (§5, see command-model).
  let applied = 0;
  for (const eff of body.effects) {
    const res = applyEffect(world, eff, packet, ctx, tick);
    if (!res.ok) return { ok: false, reason: res.reason };
    applied++;
  }
  return { ok: true, effects: applied };
}
