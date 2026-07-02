/**
 * Idempotency Guard Middleware
 *
 * Ensures requests with the same Idempotency-Key are not processed twice.
 * For now, this is a pass-through middleware. The actual idempotency logic
 * is handled in the command bus.
 */

import { createMiddleware } from "hono/factory";
import type { Env } from "../env.js";

/**
 * Idempotency guard middleware
 * Extracts the Idempotency-Key header and stores it in context
 */
export const idempotencyGuard = createMiddleware<Env>(async (_c, next) => {
  // The idempotency key is extracted and handled by the command bus
  // This middleware just ensures the header is available
  await next();
});
