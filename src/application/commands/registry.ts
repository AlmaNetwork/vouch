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

/** Define Asset Type command */
export interface DefineAssetTypePayload {
  assetTypeId: string;
  name: string;
  description?: string;
  kind: "fungible" | "credential" | "nft";
  // Fungible options
  precision?: number;
  allowNegative?: boolean;
  // Credential/NFT options
  schema?: Record<string, unknown>;
  transferable?: boolean;
  expirable?: boolean;
}

/** Issue Asset command */
export interface IssueAssetPayload {
  assetId: string;
  recipientId: string;
  // Fungible
  amount?: string;
  // Credential/NFT
  claims?: Record<string, unknown>;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

/** Transfer Asset command */
export interface TransferAssetPayload {
  assetId: string;
  toAccountId: string;
  amount?: string;  // For partial transfer of fungible
  memo?: string;
}

/** Dispose Asset command */
export interface DisposeAssetPayload {
  assetId: string;
  reason?: string;
}

/** Revoke Asset command */
export interface RevokeAssetPayload {
  assetId: string;
  reason: string;
}

/** Make Law command */
export interface MakeLawPayload {
  lawId: string;
  name: string;
  description?: string;
  lawType: "constraint" | "requirement" | "trigger";
  rule: {
    target: string | string[];
    condition?: Record<string, unknown>;
    action?: Record<string, unknown>;
    message?: string;
  };
  effectiveAt?: string;
}

/** Revise Law command */
export interface ReviseLawPayload {
  lawId: string;
  changes: {
    name?: string;
    description?: string;
    rule?: {
      target?: string | string[];
      condition?: Record<string, unknown>;
      action?: Record<string, unknown>;
      message?: string;
    };
    effectiveAt?: string;
  };
}

/** Abolish Law command */
export interface AbolishLawPayload {
  lawId: string;
  reason: string;
}

/** Invite command - create invitation */
export interface InvitePayload {
  inviteId?: string;
  email: string;
  roles?: string[];
  expiresInDays?: number;
}

/** Accept Invite command */
export interface AcceptInvitePayload {
  inviteId: string;
  accountId: string;
  residentId: string;
  residentName: string;
}

/** Suspend command - suspend an account */
export interface SuspendPayload {
  accountId: string;
  reason: string;
}

/** Reinstate command - reinstate a suspended account */
export interface ReinstatePayload {
  accountId: string;
  reason?: string;
}

/** Make Group command */
export interface MakeGroupPayload {
  groupId: string;
  name: string;
  description?: string;
  groupType: "team" | "department" | "committee" | "community";
  permissions?: string[];
}

/** Revise Group command */
export interface ReviseGroupPayload {
  groupId: string;
  changes: {
    name?: string;
    description?: string;
    permissions?: string[];
  };
}

/** Dissolve Group command */
export interface DissolveGroupPayload {
  groupId: string;
  reason: string;
}

/** Assign Member command */
export interface AssignMemberPayload {
  groupId: string;
  accountId: string;
  role: "leader" | "member";
  action: "add" | "remove" | "update";
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
  // Asset commands
  defineAssetType: DefineAssetTypePayload;
  issueAsset: IssueAssetPayload;
  transferAsset: TransferAssetPayload;
  disposeAsset: DisposeAssetPayload;
  revokeAsset: RevokeAssetPayload;
  // Law commands
  makeLaw: MakeLawPayload;
  reviseLaw: ReviseLawPayload;
  abolishLaw: AbolishLawPayload;
  // Membership commands
  invite: InvitePayload;
  acceptInvite: AcceptInvitePayload;
  suspend: SuspendPayload;
  reinstate: ReinstatePayload;
  // Organization commands
  makeGroup: MakeGroupPayload;
  reviseGroup: ReviseGroupPayload;
  dissolveGroup: DissolveGroupPayload;
  assignMember: AssignMemberPayload;
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
  | { type: "AssetTypeDefined"; payload: AssetTypeDefinedEvent }
  | { type: "AssetIssued"; payload: AssetIssuedEvent }
  | { type: "AssetTransferred"; payload: AssetTransferredEvent }
  | { type: "AssetDisposed"; payload: AssetDisposedEvent }
  | { type: "AssetRevoked"; payload: AssetRevokedEvent }
  | { type: "LawCreated"; payload: LawCreatedEvent }
  | { type: "LawRevised"; payload: LawRevisedEvent }
  | { type: "LawAbolished"; payload: LawAbolishedEvent }
  | { type: "InviteCreated"; payload: InviteCreatedEvent }
  | { type: "InviteAccepted"; payload: InviteAcceptedEvent }
  | { type: "AccountSuspended"; payload: AccountSuspendedEvent }
  | { type: "AccountReinstated"; payload: AccountReinstatedEvent }
  | { type: "GroupCreated"; payload: GroupCreatedEvent }
  | { type: "GroupRevised"; payload: GroupRevisedEvent }
  | { type: "GroupDissolved"; payload: GroupDissolvedEvent }
  | { type: "MemberAssigned"; payload: MemberAssignedEvent }
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

export interface AssetTypeDefinedEvent {
  assetTypeId: string;
  regionId: string;
  issuerId: string;
  name: string;
  description: string;
  kind: "fungible" | "credential" | "nft";
  precision: number;
  allowNegative: boolean;
  schema: Record<string, unknown> | null;
  transferable: boolean;
  expirable: boolean;
  createdAt: string;
}

export interface AssetIssuedEvent {
  assetId: string;
  accountId: string;
  assetTypeId: string;
  issuerId: string;
  balance: string;
  claims: Record<string, unknown> | null;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AssetTransferredEvent {
  assetId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string | null;
  memo: string;
  createdAt: string;
}

export interface AssetDisposedEvent {
  assetId: string;
  accountId: string;
  reason: string;
  disposedAt: string;
}

export interface AssetRevokedEvent {
  assetId: string;
  issuerId: string;
  reason: string;
  revokedAt: string;
}

export interface LawCreatedEvent {
  lawId: string;
  regionId: string;
  createdBy: string;
  name: string;
  description: string;
  lawType: "constraint" | "requirement" | "trigger";
  rule: {
    target: string | string[];
    condition?: Record<string, unknown>;
    action?: Record<string, unknown>;
    message?: string;
  };
  effectiveAt: string | null;
  createdAt: string;
}

export interface LawRevisedEvent {
  lawId: string;
  changes: Record<string, unknown>;
  revisedBy: string;
  revisedAt: string;
}

export interface LawAbolishedEvent {
  lawId: string;
  abolishedBy: string;
  reason: string;
  abolishedAt: string;
}

export interface InviteCreatedEvent {
  inviteId: string;
  regionId: string;
  email: string;
  invitedBy: string;
  roles: string[];
  expiresAt: string;
  createdAt: string;
}

export interface InviteAcceptedEvent {
  inviteId: string;
  accountId: string;
  residentId: string;
  residentName: string;
  email: string;
  acceptedAt: string;
}

export interface AccountSuspendedEvent {
  accountId: string;
  suspendedBy: string;
  reason: string;
  suspendedAt: string;
}

export interface AccountReinstatedEvent {
  accountId: string;
  reinstatedBy: string;
  reason: string;
  reinstatedAt: string;
}

export interface GroupCreatedEvent {
  groupId: string;
  regionId: string;
  createdBy: string;
  name: string;
  description: string;
  groupType: "team" | "department" | "committee" | "community";
  permissions: string[];
  createdAt: string;
}

export interface GroupRevisedEvent {
  groupId: string;
  changes: Record<string, unknown>;
  revisedBy: string;
  revisedAt: string;
}

export interface GroupDissolvedEvent {
  groupId: string;
  dissolvedBy: string;
  reason: string;
  dissolvedAt: string;
}

export interface MemberAssignedEvent {
  groupId: string;
  accountId: string;
  role: "leader" | "member";
  action: "add" | "remove" | "update";
  assignedBy: string;
  assignedAt: string;
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
