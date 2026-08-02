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
  amendInstitution,
  castVote,
  executeTransfer,
  experimenterProposal,
  immigrate,
  MAX_BALANCE,
  openProposal,
  proposeFounding,
  vouchFor,
  type WorldState,
} from "vouch-world/environment";
import type { Result, World } from "vouch-world/foundation";
import {
  canGovern,
  defineRegion,
  getRegion,
  MAX_COUNCIL_MEMBERS,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_INSTITUTION_INT,
  MAX_MEMBER_LENGTH,
  MAX_SCHEMA_ENTRIES,
  MAX_SCHEMA_ID_LENGTH,
  ownerOf,
} from "vouch-world/region";
import { z } from "zod";
import { executeCommand } from "./interpreter";

/** Longest definition id an `invoke` may name. Ids are `<namespace>.<name>`. */
const MAX_DEFINITION_ID_LENGTH = 128;
/** Most fields a data-defined command's payload may carry. */
const MAX_PAYLOAD_KEYS = 32;
/** Longest payload field name, and longest string value. */
const MAX_PAYLOAD_KEY = 64;
const MAX_PAYLOAD_STRING = 256;

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

// --- institutions -----------------------------------------------------------
//
// A region's institutions are the one part of it a participant may REWRITE, which
// makes this the widest-shaped payload on the surface — six policy kinds, several of
// them collections. Every bound is the engine's, imported rather than restated, and
// the engine validates the same things again at the mutator
// (`validateInstitutionChange`). That second pass is the real gate; these schemas
// exist so a malformed policy comes back as a 400 naming the field rather than a
// 422 "command-rejected", which for a nested object is the difference between a
// fixable error and a guessing game.

const stance = z.enum(["absorb", "map", "reexamine", "reject"]);
const schemaId = z.string().min(1).max(MAX_SCHEMA_ID_LENGTH);

const governanceValue = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dictatorship") }),
  z.object({
    kind: z.literal("council"),
    members: z.array(z.string().min(1).max(MAX_MEMBER_LENGTH)).min(1).max(MAX_COUNCIL_MEMBERS),
    threshold: z.number().int().min(1).max(MAX_INSTITUTION_INT),
    electorate: z.enum(["members", "citizens"]).optional(),
    quorum: z.number().int().min(1).max(MAX_INSTITUTION_INT).optional(),
    tenureSeq: z.number().int().min(0).max(MAX_INSTITUTION_INT).optional(),
    maturity: z.number().int().min(0).max(MAX_INSTITUTION_INT).optional(),
    weighting: z.enum(["equal", "reputation", "stake"]).optional(),
  }),
]);

const institutionChange = z.discriminatedUnion("policy", [
  z.object({
    policy: z.literal("verification"),
    value: z.object({ acceptedSchemaIds: z.array(schemaId).max(MAX_SCHEMA_ENTRIES), rejectUnknownSchemas: z.boolean() }),
  }),
  z.object({
    policy: z.literal("diplomacy"),
    value: z.object({ defaultStance: stance, overrides: z.record(schemaId, stance) }),
  }),
  z.object({
    policy: z.literal("schemaLedger"),
    value: z.array(z.object({ schemaId, label: z.string().max(MAX_SCHEMA_ID_LENGTH).optional() })).max(MAX_SCHEMA_ENTRIES),
  }),
  z.object({ policy: z.literal("governance"), value: governanceValue }),
  z.object({
    policy: z.literal("economy"),
    value: z.object({
      baseCostRate: z.number().min(0).max(1),
      minCostRate: z.number().min(0).max(1),
      repDiscount: z.number().min(0).max(1),
      creditPerTx: z.number().int().min(0).max(MAX_INSTITUTION_INT),
    }),
  }),
  z.object({
    policy: z.literal("resource"),
    value: z.object({
      capacity: z.number().int().min(0).max(MAX_INSTITUTION_INT),
      regenPerTick: z.number().int().min(0).max(MAX_INSTITUTION_INT),
    }),
  }),
]);

const regionId = z.string().min(1).max(MAX_REGION_LENGTH);

// --- data-defined commands (RFC 0007 §4) ------------------------------------
//
// `invoke` is the one door onto the interpreter: it names a definition that lives in
// the log as DATA and hands it a payload. Everything else about the request is
// unchanged — same signature, same nonce, same journal, same rate limit — because the
// authority model does not depend on whether a command's body is code or data.
//
// The payload admits SCALARS ONLY, and that is faithful rather than restrictive: the
// kernel resolves `$.field` and passes the result to asString/asNumber, so a nested
// object or array could never be read meaningfully anyway. Saying so in the schema
// bounds the payload at the same time.

const payloadValue = z.union([z.string().max(MAX_PAYLOAD_STRING), z.number(), z.boolean(), z.null()]);

const invokeSchema = z.object({
  kind: z.literal("invoke"),
  definitionId: z.string().min(1).max(MAX_DEFINITION_ID_LENGTH),
  payload: z.record(z.string().min(1).max(MAX_PAYLOAD_KEY), payloadValue).refine((p) => Object.keys(p).length <= MAX_PAYLOAD_KEYS, {
    message: `payload may carry at most ${MAX_PAYLOAD_KEYS} fields`,
  }),
});

const amendSchema = z.object({ kind: z.literal("amend"), regionId, change: institutionChange });
const proposeSchema = z.object({ kind: z.literal("propose"), regionId, change: institutionChange });
const voteSchema = z.object({ kind: z.literal("vote"), regionId });

export const commandSchema = z.discriminatedUnion("kind", [
  foundSchema,
  admitSchema,
  transferSchema,
  vouchSchema,
  migrateSchema,
  amendSchema,
  proposeSchema,
  voteSchema,
  invokeSchema,
]);
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
      // Governance is the one place authorization is NOT re-implemented here. The
      // three mutators take `by` and consult `canGovern` themselves, so the principal
      // is passed straight through and the engine decides. What this layer adds is a
      // readable REASON: the catch below flattens every engine throw into
      // "command-rejected", and for governance there are eight distinct ways to be
      // refused. Each pre-check below mirrors a guard the engine will apply anyway —
      // if they ever drift, the engine still refuses and the caller just gets the
      // generic reason instead of the specific one.
      case "amend": {
        const region = getRegion(world.getState(), command.regionId);
        if (!region) return { ok: false, reason: "unknown-region" };
        if (region.institutions.governance.kind === "council") return { ok: false, reason: "council-governed-use-propose" };
        if (!canGovern(region, principal)) return { ok: false, reason: "not-governor" };
        amendInstitution(world, command.regionId, command.change, principal);
        return { ok: true, detail: { regionId: command.regionId, policy: command.change.policy } };
      }
      case "propose": {
        const region = getRegion(world.getState(), command.regionId);
        if (!region) return { ok: false, reason: "unknown-region" };
        if (region.institutions.governance.kind !== "council") return { ok: false, reason: "not-council-governed" };
        if (!canGovern(region, principal)) return { ok: false, reason: "not-council-member" };
        // A region holds at most one open proposal, and a council cannot amend
        // directly — so an occupied slot blocks all governance until it resolves.
        if (region.openProposal) return { ok: false, reason: "proposal-already-open" };
        openProposal(world, command.regionId, command.change, principal);
        return { ok: true, detail: { regionId: command.regionId, policy: command.change.policy } };
      }
      case "invoke": {
        // The interpreter does the rest: it resolves the definition from the log,
        // checks its preconditions and applies its effects through the same
        // vouch-world primitives the hardcoded arms above call. `actor` is the
        // already-authenticated principal, so authority arrives the same way it does
        // for every other command on this surface.
        const res = executeCommand(world, { definitionId: command.definitionId, actor: principal, payload: command.payload }, ctx);
        return res.ok
          ? { ok: true, detail: { definitionId: command.definitionId, effects: res.effects } }
          : { ok: false, reason: res.reason };
      }
      case "vote": {
        const region = getRegion(world.getState(), command.regionId);
        if (!region) return { ok: false, reason: "unknown-region" };
        const proposal = region.openProposal;
        if (!proposal) return { ok: false, reason: "no-open-proposal" };
        // The roll is the RFC 0001 §5 snapshot taken at open. Being a council member
        // now is not the question — being on that roll is, which is why this reads
        // the proposal rather than the governance.
        if (!proposal.roll.some((entry) => entry.voter === principal)) return { ok: false, reason: "not-on-roll" };
        if (proposal.votes.includes(principal)) return { ok: false, reason: "already-voted" };
        const after = castVote(world, command.regionId, principal);
        // The proposal resolves in the reducer the moment approving weight crosses the
        // threshold, so it is gone from the region by the time we read back. Reporting
        // that is the difference between "my vote counted" and "the amendment passed".
        return { ok: true, detail: { regionId: command.regionId, resolved: after.openProposal === null } };
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
