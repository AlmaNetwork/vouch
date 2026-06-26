/**
 * Boot - application initialization and replay
 */

import { SqliteJournalStore } from "./infra/persistence/sqliteJournal.js";
import { replay } from "./infra/persistence/replay.js";
import { CommandBus, type StateRef } from "./application/commandBus.js";
import { createApp, type CreateAppOptions } from "./http/app.js";
import { initializeCommandRegistry } from "./application/commands/index.js";
import type { NetworkState } from "./domain/models/types.js";
import type { Hono } from "hono";
import type { Env } from "./http/env.js";

export interface BootOptions {
  dbPath: string;
}

export interface BootResult {
  app: Hono<Env>;
  journal: SqliteJournalStore;
  commandBus: CommandBus;
  getState: () => NetworkState;
  shutdown: () => void;
}

/**
 * Boot the application
 * 1. Open journal store
 * 2. Replay to restore state
 * 3. Initialize command bus
 * 4. Create Hono app
 */
export function boot(options: BootOptions): BootResult {
  console.log("[boot] Starting application...");
  console.log(`[boot] Database: ${options.dbPath}`);

  // Initialize command registry
  initializeCommandRegistry();
  console.log("[boot] Command registry initialized");

  // Open journal store
  const journal = new SqliteJournalStore(options.dbPath);
  console.log(`[boot] Journal opened, ${journal.count()} records`);

  // Replay to restore state
  const replayResult = replay(journal);
  console.log(
    `[boot] Replay complete: ${replayResult.recordCount} records, seq=${replayResult.lastSeq}`
  );

  // Mutable state reference
  let state = replayResult.state;

  const stateRef: StateRef = {
    get: () => state,
    set: (newState) => {
      state = newState;
    },
  };

  // Initialize command bus
  const commandBus = new CommandBus(journal, stateRef, replayResult.lastHash);

  // Create app
  const appOptions: CreateAppOptions = {
    getState: () => state,
    commandBus,
  };

  const app = createApp(appOptions);

  console.log("[boot] Application ready");

  return {
    app,
    journal,
    commandBus,
    getState: () => state,
    shutdown: () => {
      console.log("[shutdown] Closing journal...");
      journal.close();
      console.log("[shutdown] Done");
    },
  };
}

/**
 * Boot with default options from environment
 */
export function bootFromEnv(): BootResult {
  const dbPath = process.env.VOUCH_DB_PATH ?? "./vouch.db";
  return boot({ dbPath });
}
