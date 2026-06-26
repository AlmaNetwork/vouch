/**
 * Hono application setup
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import type { Env } from "./env.js";
import { requestId, errorHandler } from "./middleware/index.js";
import v1Routes from "./routes/v1/index.js";
import docsRoutes from "./routes/docs.js";
import type { NetworkState } from "../domain/models/types.js";
import type { CommandBus } from "../application/commandBus.js";

export interface CreateAppOptions {
  getState: () => NetworkState;
  commandBus: CommandBus;
}

export function createApp(options: CreateAppOptions): Hono<Env> {
  const app = new Hono<Env>();

  // Global middleware
  app.use("*", logger());
  app.use("*", cors());
  app.use("*", requestId);

  // Inject dependencies
  app.use("*", async (c, next) => {
    c.set("state", options.getState());
    c.set("commandBus", options.commandBus);
    await next();
  });

  // Error handler
  app.onError(errorHandler);

  // Mount v1 routes
  app.route("/v1", v1Routes);

  // Mount docs routes
  app.route("/docs", docsRoutes);

  // Root health check
  app.get("/", (c) => {
    return c.json({
      name: "vouch",
      version: "1.0.0",
      status: "ok",
    });
  });

  // 404 handler
  app.notFound((c) => {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Route not found",
          requestId: c.get("requestId"),
        },
      },
      404
    );
  });

  return app;
}
