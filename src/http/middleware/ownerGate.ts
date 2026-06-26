/**
 * Owner Gate middleware
 * Restricts access to owner-only operations
 */

import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../env.js";
import { ownerPolicy } from "../../domain/policies/index.js";

/**
 * Owner gate - requires principal to be network owner
 */
export const ownerGate = createMiddleware<Env>(async (c, next) => {
  const state = c.get("state");
  const principal = c.get("principal");

  if (!ownerPolicy.canPerformOwnerOperation(state, principal)) {
    throw new HTTPException(403, { message: "Owner access required" });
  }

  await next();
});

/**
 * Admin gate - requires admin or system role
 */
export const adminGate = createMiddleware<Env>(async (c, next) => {
  const principal = c.get("principal");

  if (!ownerPolicy.isAdmin(principal)) {
    throw new HTTPException(403, { message: "Admin access required" });
  }

  await next();
});
