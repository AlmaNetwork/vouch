/**
 * POST /v1/simulate - Simulate commands without committing
 *
 * Validates and simulates a batch of commands without persisting.
 * Returns whether the commands would succeed and what the final state would be.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../env.js";
import { authenticate } from "../../middleware/index.js";
import {
  commandRegistry,
  type CommandPacket,
  type CommandContext,
} from "../../../application/commands/registry.js";

const simulateRoute = new Hono<Env>();

// Command payload schemas (same as execute)
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

const simulateSchema = z.object({
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
    payload: payload as CommandPacket["payload"],
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

simulateRoute.post(
  "/",
  authenticate,
  async (c) => {
    const body = await c.req.json();
    const parsed = simulateSchema.safeParse(body);

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

    // Simulate commands
    const result = commandRegistry.simulateCommands(commands, ctx);

    if (!result.valid) {
      // Return 412 Precondition Failed for simulation failures
      return c.json(
        {
          ok: false,
          valid: false,
          error: {
            code: result.error?.code || "SIMULATION_FAILED",
            message: result.error?.message || "Simulation failed",
            requestId,
            details: result.error?.details ? [result.error.details] : [],
          },
        },
        412
      );
    }

    // Simulation succeeded
    return c.json(
      {
        ok: true,
        valid: true,
        seq: result.finalState.seq,
        eventCount: result.events.length,
        schemaVersion: 1,
      },
      200
    );
  }
);

export default simulateRoute;
