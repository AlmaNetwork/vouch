/**
 * Command handlers - pure functions that produce events from commands
 */

import type { NetworkState } from "../../domain/models/types.js";
import type { DomainEvent } from "../../domain/projector.js";
import type { CommandPacket } from "../commandPacket.js";
import { handleAdmit } from "./admitHandler.js";
import { handleAmend } from "./amendHandler.js";
import { handleFound } from "./foundHandler.js";
import { handleMigrate } from "./migrateHandler.js";
import { handleTransact } from "./transactHandler.js";

/**
 * Handle a command and produce events
 * This is a pure function - no I/O, deterministic
 */
export function handle(state: NetworkState, command: CommandPacket): DomainEvent[] {
  switch (command.type) {
    case "found":
      return handleFound(state, command);
    case "amend":
      return handleAmend(state, command);
    case "admit":
      return handleAdmit(state, command);
    case "transact":
      return handleTransact(state, command);
    case "migrate":
      return handleMigrate(state, command);
    case "tick":
      // Tick commands don't produce events currently
      // They're used for time-based state progression
      return [];
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = command;
      throw new Error(`Unknown command type: ${(_exhaustive as CommandPacket).type}`);
    }
  }
}

export { handleAdmit } from "./admitHandler.js";
export { handleAmend } from "./amendHandler.js";
export { handleFound } from "./foundHandler.js";
export { handleMigrate } from "./migrateHandler.js";
export { handleTransact } from "./transactHandler.js";
