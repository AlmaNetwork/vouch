/**
 * POST /v1/execute - Execute commands
 *
 * Executes a batch of commands atomically.
 * All commands are validated first, then applied.
 */

import { Hono } from "hono";
import { z } from "zod";
import { type CommandContext, type CommandPacket, commandRegistry } from "../../../application/commands/registry.js";
import { DomainError } from "../../../domain/models/errors.js";
import type { Env } from "../../env.js";
import { authenticate, idempotencyGuard } from "../../middleware/index.js";

const executeRoute = new Hono<Env>();

// Command payload schemas
const commandSchemas = {
  establish: z.object({
    regionId: z.string().min(1),
    regionName: z.string().min(1),
    inviteIds: z.array(z.string()).optional(),
  }),
  admit: z.object({
    accountId: z.string().min(1),
    email: z.string().email(),
    residentId: z.string().uuid(),
    residentName: z.string().min(1),
  }),
  amend: z.object({
    changes: z.object({
      ownerId: z.string().optional(),
      regionName: z.string().optional(),
    }),
  }),
  transact: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    amount: z.string().min(1),
    assetId: z.string().min(1),
    memo: z.string().optional(),
  }),
  // Asset commands
  defineAssetType: z.object({
    assetTypeId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    kind: z.enum(["fungible", "credential", "nft"]),
    precision: z.number().int().min(0).max(18).optional(),
    allowNegative: z.boolean().optional(),
    schema: z.record(z.unknown()).optional(),
    transferable: z.boolean().optional(),
    expirable: z.boolean().optional(),
  }),
  issueAsset: z.object({
    assetId: z.string().min(1),
    recipientId: z.string().min(1),
    amount: z.string().optional(),
    claims: z.record(z.unknown()).optional(),
    expiresAt: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  transferAsset: z.object({
    assetId: z.string().min(1),
    toAccountId: z.string().min(1),
    amount: z.string().optional(),
    memo: z.string().optional(),
  }),
  disposeAsset: z.object({
    assetId: z.string().min(1),
    reason: z.string().optional(),
  }),
  revokeAsset: z.object({
    assetId: z.string().min(1),
    reason: z.string().min(1),
  }),
  // Law commands
  makeLaw: z.object({
    lawId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    lawType: z.enum(["constraint", "requirement", "trigger"]),
    rule: z.object({
      target: z.union([z.string().min(1), z.array(z.string().min(1))]),
      condition: z.record(z.unknown()).optional(),
      action: z.record(z.unknown()).optional(),
      message: z.string().optional(),
    }),
    effectiveAt: z.string().optional(),
  }),
  reviseLaw: z.object({
    lawId: z.string().min(1),
    changes: z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      rule: z
        .object({
          target: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
          condition: z.record(z.unknown()).optional(),
          action: z.record(z.unknown()).optional(),
          message: z.string().optional(),
        })
        .optional(),
      effectiveAt: z.string().optional(),
    }),
  }),
  abolishLaw: z.object({
    lawId: z.string().min(1),
    reason: z.string().min(1),
  }),
  // Membership commands
  invite: z.object({
    inviteId: z.string().uuid().optional(),
    email: z.string().email(),
    roles: z.array(z.string()).optional(),
    expiresInDays: z.number().int().min(1).max(90).optional(),
  }),
  acceptInvite: z.object({
    inviteId: z.string().uuid(),
    accountId: z.string().min(1),
    residentId: z.string().uuid(),
    residentName: z.string().min(1),
  }),
  suspend: z.object({
    accountId: z.string().min(1),
    reason: z.string().min(1),
  }),
  reinstate: z.object({
    accountId: z.string().min(1),
    reason: z.string().optional(),
  }),
  // Organization commands
  makeGroup: z.object({
    groupId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    groupType: z.enum(["team", "department", "committee", "community"]),
    permissions: z.array(z.string()).optional(),
  }),
  reviseGroup: z.object({
    groupId: z.string().min(1),
    changes: z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      permissions: z.array(z.string()).optional(),
    }),
  }),
  dissolveGroup: z.object({
    groupId: z.string().min(1),
    reason: z.string().min(1),
  }),
  assignMember: z.object({
    groupId: z.string().min(1),
    accountId: z.string().min(1),
    role: z.enum(["leader", "member"]),
    action: z.enum(["add", "remove", "update"]),
  }),
};

const commandSchema = z
  .object({
    name: z.string().min(1),
  })
  .passthrough();

const executeSchema = z.object({
  commands: z.array(commandSchema).min(1),
});

function validateCommandPayload(rawCommand: { name: string; [key: string]: unknown }): CommandPacket | null {
  const { name: commandName, ...rawPayload } = rawCommand;

  const schema = commandSchemas[commandName as keyof typeof commandSchemas];
  if (!schema) {
    return null;
  }

  const parsed = schema.safeParse(rawPayload);
  if (!parsed.success) {
    return null;
  }

  // Map API payload to internal command payload format
  const payload = mapApiPayloadToInternal(commandName, parsed.data);

  return {
    name: commandName as CommandPacket["name"],
    payload: payload as unknown as CommandPacket["payload"],
  };
}

// Map API field names to internal command payload field names
function mapApiPayloadToInternal(commandName: string, apiPayload: Record<string, unknown>): Record<string, unknown> {
  switch (commandName) {
    case "establish":
      return {
        regionId: apiPayload.regionId,
        name: apiPayload.regionName,
        inviteIds: apiPayload.inviteIds,
      };
    case "admit":
      return {
        accountId: apiPayload.accountId,
        email: apiPayload.email,
        residentId: apiPayload.residentId,
        name: apiPayload.residentName,
      };
    case "amend": {
      const changes = apiPayload.changes as Record<string, unknown> | undefined;
      return {
        changes: {
          ownerId: changes?.ownerId,
          name: changes?.regionName,
        },
      };
    }
    // Asset commands use same field names - pass through
    case "defineAssetType":
    case "issueAsset":
    case "transferAsset":
    case "disposeAsset":
    case "revokeAsset":
    case "transact":
    // Law commands use same field names - pass through
    case "makeLaw":
    case "reviseLaw":
    case "abolishLaw":
    // Membership commands use same field names - pass through
    case "invite":
    case "acceptInvite":
    case "suspend":
    case "reinstate":
    // Organization commands use same field names - pass through
    case "makeGroup":
    case "reviseGroup":
    case "dissolveGroup":
    case "assignMember":
    default:
      return apiPayload;
  }
}

executeRoute.post("/", authenticate, idempotencyGuard, async (c) => {
  const body = await c.req.json();
  const parsed = executeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          requestId: c.get("requestId"),
          details: parsed.error.errors,
        },
      },
      400,
    );
  }

  const requestId = c.get("requestId");
  const principal = c.get("principal");
  const state = c.get("state");
  const now = new Date().toISOString();

  // Parse and validate all commands
  const commands: CommandPacket[] = [];
  for (let i = 0; i < parsed.data.commands.length; i++) {
    const rawCommand = parsed.data.commands[i];
    const command = validateCommandPayload(rawCommand);

    if (!command) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `Invalid command at index ${i}`,
            requestId,
            details: [{ index: i, name: rawCommand.name }],
          },
        },
        400,
      );
    }

    commands.push(command);
  }

  // Create command context
  const ctx: CommandContext = {
    principal,
    state,
    now,
    requestId,
    seq: state.seq,
  };

  try {
    // Execute all commands
    const result = commandRegistry.executeCommands(commands, ctx);

    // TODO: Persist events to journal
    // For now, just return success

    return c.json(
      {
        ok: true,
        seq: result.finalState.seq,
        idempotent: false,
        schemaVersion: 1,
      },
      200,
    );
  } catch (error) {
    if (error instanceof DomainError) {
      const statusMap: Record<string, number> = {
        NETWORK_ALREADY_FOUNDED: 409,
        NETWORK_NOT_FOUNDED: 400,
        ACCOUNT_ALREADY_EXISTS: 409,
        RESIDENT_ALREADY_EXISTS: 409,
        ALREADY_EXISTS: 409,
        NOT_FOUND: 404,
        VALIDATION_ERROR: 400,
        FORBIDDEN: 403,
        SELF_TRANSACTION: 400,
        UNKNOWN_COMMAND: 400,
      };
      const status = statusMap[error.code] || 400;

      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            requestId,
            details: error.details ? [error.details] : [],
          },
        },
        status as 400 | 403 | 404 | 409,
      );
    }
    throw error;
  }
});

export default executeRoute;
