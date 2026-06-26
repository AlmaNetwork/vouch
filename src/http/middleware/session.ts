/**
 * Session middleware
 * Extracts and validates authentication from request
 */

import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../env.js";
import type { Principal, AccountId } from "../../domain/models/types.js";

/**
 * Session middleware - extracts principal from token
 * For now, uses a simple token format: "account:<accountId>"
 * In production, this should use JWT or similar
 */
export const session = createMiddleware<Env>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader) {
    throw new HTTPException(401, { message: "Missing Authorization header" });
  }

  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    throw new HTTPException(401, { message: "Invalid Authorization format" });
  }

  // Simple token format: "account:<accountId>"
  // In production, use JWT verification
  const match = token.match(/^account:(.+)$/);
  if (!match) {
    throw new HTTPException(401, { message: "Invalid token format" });
  }

  const accountId = match[1] as AccountId;
  const state = c.get("state");

  // Look up account
  const account = state.accounts.get(accountId) ?? null;

  // For network founding, account may not exist yet
  // Use accountId from token as principal
  const principal: Principal = account
    ? { accountId: account.id, roles: account.roles }
    : { accountId, roles: [] };

  if (account?.disabled) {
    throw new HTTPException(401, { message: "Account is disabled" });
  }

  c.set("account", account);
  c.set("principal", principal);

  await next();
});

/**
 * Optional session - doesn't throw if no auth
 */
export const optionalSession = createMiddleware<Env>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader) {
    c.set("account", null);
    c.set("principal", { accountId: "" as AccountId, roles: [] });
    await next();
    return;
  }

  // Use regular session middleware logic
  await session(c, next);
});
