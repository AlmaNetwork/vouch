/**
 * POST /v1/amend - Amend network settings (owner only)
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../../env.js";
import { session, ownerGate } from "../../middleware/index.js";
import { amendSchema } from "../../schemas/index.js";
import { createCommand, CURRENT_SCHEMA_VERSION } from "../../../application/commandPacket.js";

const route = new Hono<Env>();

route.post(
  "/",
  session,
  ownerGate,
  zValidator("json", amendSchema),
  async (c) => {
    const body = c.req.valid("json");
    const principal = c.get("principal");
    const commandBus = c.get("commandBus");
    const requestId = c.get("requestId");

    const command = createCommand(
      "amend",
      {
        changes: body.changes,
      },
      principal,
      {
        requestId,
        receivedAt: new Date().toISOString(),
      },
      {
        idempotencyKey: c.req.header("Idempotency-Key") ?? null,
      }
    );

    const result = await commandBus.dispatch(command);

    return c.json({
      ok: result.ok,
      seq: result.seq,
      idempotent: result.idempotent,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
  }
);

export default route;
