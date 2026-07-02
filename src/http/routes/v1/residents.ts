/**
 * GET /v1/residents - List and get residents
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ResidentId } from "../../../domain/models/types.js";
import type { Env } from "../../env.js";
import { session } from "../../middleware/index.js";

const route = new Hono<Env>();

/**
 * GET /v1/residents - List all residents
 */
route.get("/", session, (c) => {
  const state = c.get("state");

  const residents = Array.from(state.residents.values()).map((resident) => ({
    id: resident.id,
    accountId: resident.accountId,
    regionId: resident.regionId,
    name: resident.name,
    status: resident.status,
    createdAt: resident.createdAt,
    updatedAt: resident.updatedAt,
  }));

  return c.json({
    residents,
    total: residents.length,
  });
});

/**
 * GET /v1/residents/:residentId - Get a specific resident
 */
route.get("/:residentId", session, (c) => {
  const residentId = c.req.param("residentId") as ResidentId;
  const state = c.get("state");

  const resident = state.residents.get(residentId);
  if (!resident) {
    throw new HTTPException(404, { message: `Resident not found: ${residentId}` });
  }

  return c.json({
    id: resident.id,
    accountId: resident.accountId,
    regionId: resident.regionId,
    name: resident.name,
    status: resident.status,
    createdAt: resident.createdAt,
    updatedAt: resident.updatedAt,
  });
});

export default route;
