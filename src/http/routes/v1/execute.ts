/**
 * POST /v1/execute - Execute commands
 *
 * Executes a batch of commands atomically.
 * All commands are validated first, then applied.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../env.js";
import { authenticate, idempotencyGuard } from "../../middleware/index.js";
import {
  commandRegistry,
  type CommandPacket,
  type CommandContext,
} from "../../../application/commands/registry.js";
import { DomainError } from "../../../domain/models/errors.js";

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
  createAssetType: z.object({
    assetTypeId: z.string().min(1),
    typeName: z.string().min(1),
    description: z.string().optional(),
    precision: z.number().int().min(0).max(18).optional(),
    allowNegative: z.boolean().optional(),
  }),
  createAsset: z.object({
    assetId: z.string().min(1),
    initialBalance: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
};

const commandSchema = z.object({
  name: z.string().min(1),
}).passthrough();

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
    case "amend":
      const changes = apiPayload.changes as Record<string, unknown> | undefined;
      return {
        changes: {
          ownerId: changes?.ownerId,
          name: changes?.regionName,
        },
      };
    case "createAssetType":
      return {
        assetTypeId: apiPayload.assetTypeId,
        name: apiPayload.typeName,
        description: apiPayload.description,
        precision: apiPayload.precision,
        allowNegative: apiPayload.allowNegative,
      };
    default:
      return apiPayload;
  }
}

executeRoute.post(
  "/",
  authenticate,
  idempotencyGuard,
  async (c) => {
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
        400
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
          400
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
        200
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
          status as 400 | 403 | 404 | 409
        );
      }
      throw error;
    }
  }
);

export default executeRoute;
