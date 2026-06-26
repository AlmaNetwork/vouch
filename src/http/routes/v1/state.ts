/**
 * GET /v1/state - Get current network state
 */

import { Hono } from "hono";
import type { Env } from "../../env.js";
import { session } from "../../middleware/index.js";

const route = new Hono<Env>();

route.get("/", session, (c) => {
  const state = c.get("state");

  return c.json({
    regionId: state.regionId,
    ownerId: state.ownerId,
    seq: state.seq,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    accountCount: state.accounts.size,
    residentCount: state.residents.size,
    ledgerCount: state.ledger.length,
  });
});

export default route;
