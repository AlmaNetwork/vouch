/**
 * GET /v1/ledger - Get transaction ledger
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../../env.js";
import { session } from "../../middleware/index.js";
import type { AccountId } from "../../../domain/models/types.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  accountId: z.string().optional(),
  // Legacy support for residentId filtering
  residentId: z.string().uuid().optional(),
});

const route = new Hono<Env>();

route.get("/", session, zValidator("query", querySchema), (c) => {
  const { limit, offset, accountId, residentId } = c.req.valid("query");
  const state = c.get("state");

  let entries = state.ledger;

  // Filter by accountId if provided
  if (accountId) {
    const typedAccountId = accountId as AccountId;
    entries = entries.filter(
      (entry) =>
        entry.fromAccountId === typedAccountId ||
        entry.toAccountId === typedAccountId
    );
  }

  // Legacy: filter by residentId if provided (map to account)
  if (residentId) {
    // Find the account associated with this resident
    for (const resident of state.residents.values()) {
      if (resident.id === residentId) {
        entries = entries.filter(
          (entry) =>
            entry.fromAccountId === resident.accountId ||
            entry.toAccountId === resident.accountId
        );
        break;
      }
    }
  }

  const total = entries.length;

  // Apply pagination
  const paginatedEntries = entries
    .slice(offset, offset + limit)
    .map((entry) => ({
      id: entry.id,
      fromAccountId: entry.fromAccountId,
      toAccountId: entry.toAccountId,
      assetTypeId: entry.assetTypeId,
      amount: entry.amount,
      memo: entry.memo,
      seq: entry.seq,
      createdAt: entry.createdAt,
    }));

  return c.json({
    entries: paginatedEntries,
    total,
    limit,
    offset,
  });
});

export default route;
