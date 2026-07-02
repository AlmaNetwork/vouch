// The command surface — what an authenticated principal may ask the world to do.
//
// Each command maps onto a REAL engine mutator (vouch-world), so conservation,
// the event log, and deterministic replay are inherited, not re-implemented. The
// node's job here is authorization: bind the acting principal to the right
// argument (you can only spend `from` your own account, admit into a region you
// own, etc.). Meaning beyond that is the engine's to enforce.

import type { KeyPair } from "vouch-core";
import {
  admitAgent,
  admitTreasury,
  executeTransfer,
  experimenterProposal,
  proposeFounding,
  vouchFor,
  type WorldState,
} from "vouch-world/environment";
import type { Result, World } from "vouch-world/foundation";
import { defineRegion, ownerOf } from "vouch-world/region";
import { z } from "zod";

const foundSchema = z.object({
  kind: z.literal("found"),
  regionId: z.string().min(1),
  displayName: z.string().min(1),
});

const admitSchema = z.object({
  kind: z.literal("admit"),
  agentId: z.string().min(1),
  region: z.string().min(1),
  role: z.enum(["artisan", "merchant", "broker", "treasury"]),
  valueProfile: z.enum(["strict", "lenient"]).optional(),
  currency: z.number().int().nonnegative().optional(),
});

const transferSchema = z.object({
  kind: z.literal("transfer"),
  from: z.string().min(1),
  to: z.string().min(1),
  amount: z.number().int().positive(),
});

const vouchSchema = z.object({
  kind: z.literal("vouch"),
  from: z.string().min(1),
  to: z.string().min(1),
  weight: z.number().int().min(1).max(5),
});

export const commandSchema = z.discriminatedUnion("kind", [foundSchema, admitSchema, transferSchema, vouchSchema]);
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
    }
  } catch {
    // Engine mutators throw on malformed input (bad id, region missing, duplicate,
    // internal-invariant guards). Don't reflect the raw message to the client — those
    // strings can carry internal prefixes/invariant text. A generic reason is enough;
    // the result-returning mutators (transfer/vouch) still surface their clean domain reasons above.
    return { ok: false, reason: "command-rejected" };
  }
}
