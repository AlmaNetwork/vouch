/**
 * Pluggable Command Registry
 *
 * Supports dynamic command registration and execution.
 * Commands are validated, then applied in two phases:
 * 1. validate: Check all preconditions
 * 2. apply: Execute the command and produce events
 */

import type { NetworkState, Principal } from "../../domain/models/types.js";
import { DomainError } from "../../domain/models/errors.js";

// ============================================================
// Command Payload Types
// ============================================================

/** Establish command - create a new region */
export interface EstablishPayload {
  regionId: string;
  name: string;
  inviteIds?: string[];
}

/** Admit command - add a new resident */
export interface AdmitPayload {
  accountId: string;
  email: string;
  residentId: string;
  name: string;
}

/** Amend command - modify region settings */
export interface AmendPayload {
  changes: {
    ownerId?: string;
    name?: string;
  };
}

/** Transact command - execute a transaction */
export interface TransactPayload {
  from: string;
  to: string;
  amount: string;
  assetId: string;
  memo?: string;
}

/** Migrate command - migrate schema version */
export interface MigratePayload {
  targetVersion: number;
}

/** Tick command - time-based state progression */
export interface TickPayload {
  tickAt: string;
  reason: string;
}

/** Create Asset Type command */
export interface CreateAssetTypePayload {
  assetTypeId: string;
  name: string;
  description?: string;
  precision?: number;
  allowNegative?: boolean;
}

/** Create Asset command */
export interface CreateAssetPayload {
  assetId: string;
  initialBalance?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================
// Command Payload Map (Single Source of Truth)
// ============================================================

export interface CommandPayloadMap {
  establish: EstablishPayload;
  admit: AdmitPayload;
  amend: AmendPayload;
  transact: TransactPayload;
  migrate: MigratePayload;
  tick: TickPayload;
  createAssetType: CreateAssetTypePayload;
  createAsset: CreateAssetPayload;
}

export type CommandName = keyof CommandPayloadMap;

// ============================================================
// Command Packet
// ============================================================

export interface CommandPacket<N extends CommandName = CommandName> {
  name: N;
  payload: CommandPayloadMap[N];
}

export interface ExecuteRequest {
  commands: CommandPacket[];
}

// ============================================================
// Command Context
// ============================================================

export interface CommandContext {
  principal: Principal;
  state: NetworkState;
  now: string;
  requestId: string;
  seq: number;
}

// ============================================================
// Command Result
// ============================================================

export interface CommandResult {
  /** Events produced by the command */
  events: DomainEvent[];
  /** Updated state after applying events */
  newState: NetworkState;
}

// ============================================================
// Domain Events
// ============================================================

export type DomainEvent =
  | { type: "RegionEstablished"; payload: RegionEstablishedEvent }
  | { type: "AccountCreated"; payload: AccountCreatedEvent }
  | { type: "ResidentAdmitted"; payload: ResidentAdmittedEvent }
  | { type: "TransactionExecuted"; payload: TransactionExecutedEvent }
  | { type: "RegionAmended"; payload: RegionAmendedEvent }
  | { type: "AssetTypeCreated"; payload: AssetTypeCreatedEvent }
  | { type: "AssetCreated"; payload: AssetCreatedEvent }
  | { type: "SchemaVersionMigrated"; payload: SchemaVersionMigratedEvent };

export interface RegionEstablishedEvent {
  regionId: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  createdAt: string;
}

export interface AccountCreatedEvent {
  accountId: string;
  email: string;
  regionId: string;
  roles: string[];
  createdAt: string;
}

export interface ResidentAdmittedEvent {
  residentId: string;
  accountId: string;
  name: string;
  regionId: string;
  createdAt: string;
}

export interface TransactionExecutedEvent {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  assetTypeId: string;
  amount: string;
  memo: string;
  seq: number;
  createdAt: string;
}

export interface RegionAmendedEvent {
  changes: Record<string, unknown>;
  updatedAt: string;
}

export interface AssetTypeCreatedEvent {
  assetTypeId: string;
  regionId: string;
  name: string;
  description: string;
  precision: number;
  allowNegative: boolean;
  createdAt: string;
}

export interface AssetCreatedEvent {
  assetId: string;
  accountId: string;
  assetTypeId: string;
  initialBalance: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SchemaVersionMigratedEvent {
  fromVersion: number;
  toVersion: number;
  migratedAt: string;
}

// ============================================================
// Command Handler Interface
// ============================================================

export interface CommandHandler<N extends CommandName> {
  /** Command name this handler processes */
  name: N;

  /**
   * Validate command preconditions.
   * Should throw DomainError if validation fails.
   */
  validate(
    payload: CommandPayloadMap[N],
    ctx: CommandContext
  ): void;

  /**
   * Apply the command and produce events.
   * Called only after validation passes.
   */
  apply(
    payload: CommandPayloadMap[N],
    ctx: CommandContext
  ): CommandResult;
}

// ============================================================
// Command Registry
// ============================================================

export class CommandRegistry {
  private handlers = new Map<CommandName, CommandHandler<CommandName>>();

  /** Register a command handler */
  register<N extends CommandName>(handler: CommandHandler<N>): void {
    this.handlers.set(handler.name, handler as CommandHandler<CommandName>);
  }

  /** Get handler for a command name */
  getHandler<N extends CommandName>(name: N): CommandHandler<N> | undefined {
    return this.handlers.get(name) as CommandHandler<N> | undefined;
  }

  /** Check if a command is registered */
  hasHandler(name: string): name is CommandName {
    return this.handlers.has(name as CommandName);
  }

  /** Get all registered command names */
  getCommandNames(): CommandName[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Validate a single command.
   * Throws DomainError if validation fails.
   */
  validateCommand(
    command: CommandPacket,
    ctx: CommandContext
  ): void {
    const handler = this.getHandler(command.name);
    if (!handler) {
      throw new DomainError(
        "UNKNOWN_COMMAND",
        `Unknown command: ${command.name}`,
        { command: command.name }
      );
    }
    handler.validate(command.payload, ctx);
  }

  /**
   * Apply a single command and produce events.
   * Assumes validation has already passed.
   */
  applyCommand(
    command: CommandPacket,
    ctx: CommandContext
  ): CommandResult {
    const handler = this.getHandler(command.name);
    if (!handler) {
      throw new DomainError(
        "UNKNOWN_COMMAND",
        `Unknown command: ${command.name}`,
        { command: command.name }
      );
    }
    return handler.apply(command.payload, ctx);
  }

  /**
   * Execute multiple commands atomically.
   * Validates all commands first, then applies them in order.
   * If any validation fails, no commands are applied.
   */
  executeCommands(
    commands: CommandPacket[],
    initialCtx: CommandContext
  ): { events: DomainEvent[]; finalState: NetworkState } {
    // Phase 1: Validate all commands
    let currentCtx = { ...initialCtx };
    for (const command of commands) {
      this.validateCommand(command, currentCtx);
      // Apply to get updated state for next validation
      const result = this.applyCommand(command, currentCtx);
      currentCtx = {
        ...currentCtx,
        state: result.newState,
        seq: currentCtx.seq + 1,
      };
    }

    // Phase 2: Apply all commands (re-apply from initial state for actual execution)
    const allEvents: DomainEvent[] = [];
    currentCtx = { ...initialCtx };

    for (const command of commands) {
      const result = this.applyCommand(command, currentCtx);
      allEvents.push(...result.events);
      currentCtx = {
        ...currentCtx,
        state: result.newState,
        seq: currentCtx.seq + 1,
      };
    }

    return {
      events: allEvents,
      finalState: currentCtx.state,
    };
  }

  /**
   * Simulate commands without committing.
   * Returns the final state and events that would be produced.
   */
  simulateCommands(
    commands: CommandPacket[],
    ctx: CommandContext
  ): { events: DomainEvent[]; finalState: NetworkState; valid: boolean; error?: DomainError } {
    try {
      const result = this.executeCommands(commands, ctx);
      return {
        ...result,
        valid: true,
      };
    } catch (error) {
      if (error instanceof DomainError) {
        return {
          events: [],
          finalState: ctx.state,
          valid: false,
          error,
        };
      }
      throw error;
    }
  }
}

// ============================================================
// Global Registry Instance
// ============================================================

export const commandRegistry = new CommandRegistry();
