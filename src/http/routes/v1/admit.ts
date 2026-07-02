/**
 * POST /v1/admit - Admit a new resident
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { CURRENT_SCHEMA_VERSION, createCommand } from "../../../application/commandPacket.js";
import type { Env } from "../../env.js";
import { ownerGate, session } from "../../middleware/index.js";
import { admitSchema } from "../../schemas/index.js";

const route = new Hono<Env>();

route.post("/", session, ownerGate, zValidator("json", admitSchema), async (c) => {
  const body = c.req.valid("json");
  const principal = c.get("principal");
  const commandBus = c.get("commandBus");
  const requestId = c.get("requestId");

  const command = createCommand(
    "admit",
    {
      accountId: body.accountId,
      email: body.email,
      residentId: body.residentId,
      name: body.name,
      initialStatus: body.initialStatus,
    },
    principal,
    {
      requestId,
      receivedAt: new Date().toISOString(),
    },
    {
      idempotencyKey: c.req.header("Idempotency-Key") ?? null,
    },
  );

  const result = await commandBus.dispatch(command);

  return c.json(
    {
      ok: result.ok,
      seq: result.seq,
      idempotent: result.idempotent,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    },
    result.idempotent ? 200 : 201,
  );
});

export default route;
