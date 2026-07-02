/**
 * Command Packet definitions
 * Discriminated union of all commands that can modify state
 */

import type { Principal, ResidentStatus } from "../domain/models/types.js";

/** Current schema version */
export const CURRENT_SCHEMA_VERSION = 1;

/** Base command metadata */
export interface CommandMeta {
  requestId: string;
  receivedAt: string;
}

/** Base command structure */
export interface BaseCommand {
  commandId: string;
  idempotencyKey: string | null;
  schemaVersion: number;
  principal: Principal;
  meta: CommandMeta;
}

/** Found command - create a new network */
export interface FoundCommand extends BaseCommand {
  type: "found";
  payload: {
    regionId: string;
    ownerEmail: string;
  };
}

/** Amend command - modify network settings (owner only) */
export interface AmendCommand extends BaseCommand {
  type: "amend";
  payload: {
    changes: {
      ownerId?: string;
    };
  };
}

/** Admit command - add a new resident */
export interface AdmitCommand extends BaseCommand {
  type: "admit";
  payload: {
    accountId: string;
    email: string;
    residentId: string;
    name: string;
    initialStatus?: ResidentStatus;
  };
}

/** Transact command - execute a transaction */
export interface TransactCommand extends BaseCommand {
  type: "transact";
  payload: {
    fromResidentId: string;
    toResidentId: string;
    amount: string;
    memo: string;
  };
}

/** Migrate command - migrate schema version */
export interface MigrateCommand extends BaseCommand {
  type: "migrate";
  payload: {
    targetVersion: number;
  };
}

/** Tick command - time-based state progression */
export interface TickCommand extends BaseCommand {
  type: "tick";
  payload: {
    tickAt: string;
    reason: string;
  };
}

/** Union of all command types */
export type CommandPacket = FoundCommand | AmendCommand | AdmitCommand | TransactCommand | MigrateCommand | TickCommand;

/** Command type strings */
export type CommandType = CommandPacket["type"];

/** Create a command packet with common fields */
export function createCommand<T extends CommandType>(
  type: T,
  payload: Extract<CommandPacket, { type: T }>["payload"],
  principal: Principal,
  meta: CommandMeta,
  options: { commandId?: string; idempotencyKey?: string | null } = {},
): Extract<CommandPacket, { type: T }> {
  return {
    commandId: options.commandId ?? crypto.randomUUID(),
    idempotencyKey: options.idempotencyKey ?? null,
    type,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    principal,
    payload,
    meta,
  } as Extract<CommandPacket, { type: T }>;
}
