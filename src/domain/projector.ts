/**
 * Projector - pure function to apply events to state
 * No validation, no I/O - used during replay
 */

import type {
  NetworkState,
  Account,
  Resident,
  LedgerEntry,
  AccountId,
  RegionId,
} from "./models/types.js";

/** Event types that can be applied to state */
export type DomainEvent =
  | NetworkFoundedEvent
  | NetworkAmendedEvent
  | ResidentAdmittedEvent
  | TransactionExecutedEvent
  | SchemaMigratedEvent;

export interface NetworkFoundedEvent {
  type: "NetworkFounded";
  regionId: string;
  ownerId: string;
  ownerEmail: string;
  timestamp: string;
}

export interface NetworkAmendedEvent {
  type: "NetworkAmended";
  changes: Partial<{
    ownerId: string;
  }>;
  timestamp: string;
}

export interface ResidentAdmittedEvent {
  type: "ResidentAdmitted";
  resident: Resident;
  account: Account;
  timestamp: string;
}

export interface TransactionExecutedEvent {
  type: "TransactionExecuted";
  entry: LedgerEntry;
  timestamp: string;
}

export interface SchemaMigratedEvent {
  type: "SchemaMigrated";
  fromVersion: number;
  toVersion: number;
  timestamp: string;
}

/**
 * Apply a single event to state (pure function)
 */
export function applyEvent(state: NetworkState, event: DomainEvent): NetworkState {
  switch (event.type) {
    case "NetworkFounded":
      return applyNetworkFounded(state, event);
    case "NetworkAmended":
      return applyNetworkAmended(state, event);
    case "ResidentAdmitted":
      return applyResidentAdmitted(state, event);
    case "TransactionExecuted":
      return applyTransactionExecuted(state, event);
    case "SchemaMigrated":
      return applySchemaMigrated(state, event);
    default:
      return state;
  }
}

/**
 * Apply multiple events to state
 */
export function applyEvents(
  state: NetworkState,
  events: DomainEvent[]
): NetworkState {
  return events.reduce((s, e) => applyEvent(s, e), state);
}

function applyNetworkFounded(
  state: NetworkState,
  event: NetworkFoundedEvent
): NetworkState {
  const ownerId = event.ownerId as AccountId;
  const regionId = event.regionId as RegionId;

  const ownerAccount: Account = {
    id: ownerId,
    email: event.ownerEmail,
    regionId,
    residentId: null,
    roles: ["owner"],
    disabled: false,
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
  };

  const accounts = new Map(state.accounts);
  accounts.set(ownerId, ownerAccount);

  return {
    ...state,
    regionId,
    ownerId,
    accounts,
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
  };
}

function applyNetworkAmended(
  state: NetworkState,
  event: NetworkAmendedEvent
): NetworkState {
  const newOwnerId = event.changes.ownerId ? event.changes.ownerId as AccountId : undefined;
  return {
    ...state,
    ...(newOwnerId && { ownerId: newOwnerId }),
    updatedAt: event.timestamp,
  };
}

function applyResidentAdmitted(
  state: NetworkState,
  event: ResidentAdmittedEvent
): NetworkState {
  const accounts = new Map(state.accounts);
  const residents = new Map(state.residents);

  accounts.set(event.account.id, event.account);
  residents.set(event.resident.id, event.resident);

  return {
    ...state,
    accounts,
    residents,
    updatedAt: event.timestamp,
  };
}

function applyTransactionExecuted(
  state: NetworkState,
  event: TransactionExecutedEvent
): NetworkState {
  return {
    ...state,
    ledger: [...state.ledger, event.entry],
    updatedAt: event.timestamp,
  };
}

function applySchemaMigrated(
  state: NetworkState,
  event: SchemaMigratedEvent
): NetworkState {
  return {
    ...state,
    updatedAt: event.timestamp,
  };
}
