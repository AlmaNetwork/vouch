/**
 * Entry point - starts the HTTP server
 */

import { serve } from "@hono/node-server";
import { bootFromEnv } from "./boot.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Boot application
const { app, shutdown } = bootFromEnv();

// Start server
const server = serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`[server] Listening on http://localhost:${info.port}`);
  }
);

// Graceful shutdown
function handleShutdown() {
  console.log("\n[server] Shutting down...");
  server.close();
  shutdown();
  process.exit(0);
}

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
