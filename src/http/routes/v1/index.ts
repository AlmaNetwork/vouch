/**
 * V1 API routes
 */

import { Hono } from "hono";
import type { Env } from "../../env.js";
import admitRoute from "./admit.js";
import amendRoute from "./amend.js";
// Command routes (new API)
import establishRoute from "./establish.js";
import executeRoute from "./execute.js";
// Command routes (legacy - for backward compatibility)
import foundRoute from "./found.js";
import ledgerRoute from "./ledger.js";
import migrateRoute from "./migrate.js";
import residentsRoute from "./residents.js";
import simulateRoute from "./simulate.js";
// Query routes (read operations)
import stateRoute from "./state.js";
import transactRoute from "./transact.js";

const v1 = new Hono<Env>();

// New API routes
v1.route("/establish", establishRoute);
v1.route("/execute", executeRoute);
v1.route("/simulate", simulateRoute);

// Legacy command routes (for backward compatibility)
v1.route("/found", foundRoute);
v1.route("/amend", amendRoute);
v1.route("/admit", admitRoute);
v1.route("/transact", transactRoute);
v1.route("/migrate", migrateRoute);

// Query routes (read operations)
v1.route("/state", stateRoute);
v1.route("/residents", residentsRoute);
v1.route("/ledger", ledgerRoute);

// Health check
v1.get("/health", (c) => {
  const state = c.get("state");
  return c.json({
    status: "ok",
    regionId: state.regionId || null,
    seq: state.seq,
    founded: state.regionId !== "",
  });
});

export default v1;
