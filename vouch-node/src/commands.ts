// The command surface — what an authenticated principal may ask the world to do.
//
// Each command maps onto a REAL engine mutator (vouch-world), so conservation,
// the event log, and deterministic replay are inherited, not re-implemented. The
// node's job here is authorization: bind the acting principal to the right
// argument (you can only spend `from` your own account, admit into a region you
// own, etc.). Meaning beyond that is the engine's to enforce.

import { type KeyPair, MAX_IDENTIFIER_LENGTH, MAX_REGION_LENGTH } from "vouch-core";
import { getAgent } from "vouch-world/agent";
import {
  admitAgent,
  admitTreasury,
  executeTransfer,
  experimenterProposal,
  immigrate,
  MAX_BALANCE,
  proposeFounding,
  vouchFor,
  type WorldState,
} from "vouch-world/environment";
import type { Result, World } from "vouch-world/foundation";
import { defineRegion, getRegion, MAX_DISPLAY_NAME_LENGTH, ownerOf } from "vouch-world/region";
import { z } from "zod";

// Every bound below is the ENGINE's bound, imported rather than restated. The engine
// enforces them too, so a command that slips past this schema still cannot get through
// — but rejecting here turns a 422 "command-rejected" into a 400 that says which field
// was wrong, and it does so before any engine work happens.
//
// Without them the node accepts, and permanently journals, a 200KB region id or an
// opening balance of Number.MAX_SAFE_INTEGER (both measured; see docs/LAUNCH.md).

const foundSchema = z.object({
  kind: z.literal("found"),
  regionId: z.string().min(1).max(MAX_REGION_LENGTH),
  displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
});

const admitSchema = z.object({
  kind: z.literal("admit"),
  agentId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  region: z.string().min(1).max(MAX_REGION_LENGTH),
  role: z.enum(["artisan", "merchant", "broker", "treasury"]),
  valueProfile: z.enum(["strict", "lenient"]).optional(),
  currency: z.number().int().nonnegative().max(MAX_BALANCE).optional(),
});

const transferSchema = z.object({
  kind: z.literal("transfer"),
  from: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  to: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  amount: z.number().int().positive().max(MAX_BALANCE),
});

const vouchSchema = z.object({
  kind: z.literal("vouch"),
  from: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  to: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  weight: z.number().int().min(1).max(5),
});

const migrateSchema = z.object({
  kind: z.literal("migrate"),
  agentId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  toRegion: z.string().min(1).max(MAX_REGION_LENGTH),
});

export const commandSchema = z.discriminatedUnion("kind", [foundSchema, admitSchema, transferSchema, vouchSchema, migrateSchema]);
export type Command = z.infer<typeof commandSchema>;

export type CommandResult = Result<{ detail?: Record<string, unknown> }>;

export interface DispatchContext {
  readonly notary: KeyPair;
}

/**
 * Apply an already-authenticated command to the world. The principal is trusted
 * (its signature was verified upstream); here we only enforce that the principal
 * is entitled to the specific action. Engine mutators either return a result or
 * throw on malformed input — both are normalized to a CommandResult.
 */
export function dispatch(world: World<WorldState>, principal: string, command: Command, ctx: DispatchContext): CommandResult {
  try {
    switch (command.kind) {
      case "found": {
        // The founder becomes the region owner (an ID may own many regions). Seed the
        // region's treasury too, so its economy (the fee sink) works from the start.
        proposeFounding(
          world,
          experimenterProposal(defineRegion(command.regionId, command.displayName), `founded by ${principal}`, principal),
        );
        admitTreasury(world, command.regionId);
        return { ok: true, detail: { regionId: command.regionId, owner: principal } };
      }
      case "admit": {
        if (ownerOf(world.getState(), command.region) !== principal) return { ok: false, reason: "not-region-owner" };
        admitAgent(world, {
          id: command.agentId,
          region: command.region,
          role: command.role,
          valueProfile: command.valueProfile ?? "lenient",
          publicKey: "",
          currency: command.currency,
        });
        return { ok: true, detail: { agentId: command.agentId } };
      }
      case "transfer": {
        if (command.from !== principal) return { ok: false, reason: "not-sender" };
        const res = executeTransfer(
          world,
          { from: command.from, to: command.to, amount: command.amount },
          { tick: world.tick, notary: ctx.notary },
        );
        return res.ok ? { ok: true, detail: { fee: res.fee } } : { ok: false, reason: res.reason };
      }
      case "vouch": {
        if (command.from !== principal) return { ok: false, reason: "not-voucher" };
        const res = vouchFor(world, command.from, command.to, command.weight);
        return res.ok ? { ok: true } : { ok: false, reason: res.reason };
      }
      case "migrate": {
        // You move yourself and nobody else. There is no expulsion: a region owner
        // cannot evict a resident, and no one can drag someone into their region.
        // Migration is the exit half of "the disadvantaged move on" (README) — it is
        // the participant's own lever, so it is bound to their own identity.
        if (command.agentId !== principal) return { ok: false, reason: "not-self" };
        const state = world.getState();
        const agent = getAgent(state, command.agentId);
        if (!agent) return { ok: false, reason: "unknown-agent" };
        // Refuse the no-op rather than journalling it. `immigrate` would happily emit
        // an event for a move to where you already are, and the journal is permanent,
        // so a back-and-forth loop would be free growth.
        if (agent.region === command.toRegion) return { ok: false, reason: "already-resident" };
        if (!getRegion(state, command.toRegion)) return { ok: false, reason: "unknown-region" };
        immigrate(world, command.agentId, command.toRegion);
        // Citizenship does not move. The id keeps its birth region, so `ann@umi` living
        // in yama is a resident of yama and a citizen of umi — which is exactly the
        // distinction sanctions.ts reads when it asks who may act on someone.
        return { ok: true, detail: { agentId: command.agentId, from: agent.region, to: command.toRegion } };
      }
    }
  } catch {
    // Engine mutators throw on malformed input (bad id, region missing, duplicate,
    // internal-invariant guards). Don't reflect the raw message to the client — those
    // strings can carry internal prefixes/invariant text. A generic reason is enough;
    // the result-returning mutators (transfer/vouch) still surface their clean domain reasons above.
    return { ok: false, reason: "command-rejected" };
  }
}
