/**
 * Request ID middleware
 * Generates unique request ID for tracing
 */

import { createMiddleware } from "hono/factory";
import type { Env } from "../env.js";

export const requestId = createMiddleware<Env>(async (c, next) => {
  const id = c.req.header("X-Request-ID") ?? crypto.randomUUID();
  c.set("requestId", id);
  c.header("X-Request-ID", id);
  await next();
});
