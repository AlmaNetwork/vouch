/**
 * POST /v1/establish - Create a new region
 */

import { Hono } from "hono";
import { z } from "zod";
import { createCommand } from "../../../application/commandPacket.js";
import type { Env } from "../../env.js";
import { authenticate, idempotencyGuard } from "../../middleware/index.js";

const establishRoute = new Hono<Env>();

const establishSchema = z.object({
  regionId: z.string().min(1, "regionId is required"),
  name: z.string().min(1, "name is required"),
  inviteIds: z.array(z.string()).optional(),
});

establishRoute.post("/", authenticate, idempotencyGuard, async (c) => {
  const body = await c.req.json();
  const parsed = establishSchema.safeParse(body);

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

  const principal = c.get("principal");
  const commandBus = c.get("commandBus");
  const requestId = c.get("requestId");
  const idempotencyKey = c.req.header("Idempotency-Key") ?? null;

  // Create establish command (mapped to found internally for backward compat)
  const command = createCommand(
    "found",
    {
      regionId: parsed.data.regionId,
      ownerEmail: "", // Email will be set from account if needed
    },
    principal,
    {
      requestId,
      receivedAt: new Date().toISOString(),
    },
    { idempotencyKey },
  );

  try {
    const result = await commandBus.dispatch(command);

    return c.json(
      {
        ok: true,
        seq: result.seq,
        idempotent: result.idempotent,
        schemaVersion: result.schemaVersion,
      },
      201,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "DomainError") {
      const domainError = error as Error & { code: string; details?: unknown };
      const statusMap: Record<string, number> = {
        NETWORK_ALREADY_FOUNDED: 409,
        VALIDATION_ERROR: 400,
      };
      const status = statusMap[domainError.code] || 400;

      return c.json(
        {
          error: {
            code: domainError.code,
            message: domainError.message,
            requestId,
            details: domainError.details || [],
          },
        },
        status as 400 | 409,
      );
    }
    throw error;
  }
});

export default establishRoute;
