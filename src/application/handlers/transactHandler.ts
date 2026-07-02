/**
 * Transact command handler
 * Executes a transaction between residents
 */

import {
  forbidden,
  invalidAmount,
  networkNotFounded,
  residentNotActive,
  residentNotFound,
  selfTransaction,
} from "../../domain/models/errors.js";
import type { AssetTypeId, LedgerEntry, NetworkState, ResidentId } from "../../domain/models/types.js";
import { ownerPolicy } from "../../domain/policies/index.js";
import type { TransactionExecutedEvent } from "../../domain/projector.js";
import type { TransactCommand } from "../commandPacket.js";

export function handleTransact(state: NetworkState, command: TransactCommand): TransactionExecutedEvent[] {
  // Validate: network must exist
  if (state.regionId === "") {
    throw networkNotFounded();
  }

  const { fromResidentId, toResidentId, amount, memo } = command.payload;

  // Cast to branded types
  const typedFromResidentId = fromResidentId as ResidentId;
  const typedToResidentId = toResidentId as ResidentId;

  // Validate: can't transact with yourself
  if (fromResidentId === toResidentId) {
    throw selfTransaction();
  }

  // Validate: amount must be valid (positive decimal string)
  if (!isValidAmount(amount)) {
    throw invalidAmount();
  }

  // Validate: from resident must exist
  const fromResident = state.residents.get(typedFromResidentId);
  if (!fromResident) {
    throw residentNotFound(fromResidentId);
  }

  // Validate: to resident must exist
  const toResident = state.residents.get(typedToResidentId);
  if (!toResident) {
    throw residentNotFound(toResidentId);
  }

  // Validate: from resident must be active
  if (fromResident.status !== "active") {
    throw residentNotActive(fromResidentId);
  }

  // Validate: to resident must be active
  if (toResident.status !== "active") {
    throw residentNotActive(toResidentId);
  }

  // Validate: principal must have permission to transact from this resident
  if (!ownerPolicy.canTransact(state, command.principal, typedFromResidentId)) {
    throw forbidden("Cannot transact on behalf of this resident");
  }

  // Create ledger entry with new format
  // For backward compatibility, map resident IDs to account IDs
  const fromAccount = state.accounts.get(fromResident.accountId);
  const toAccount = state.accounts.get(toResident.accountId);

  if (!fromAccount || !toAccount) {
    throw forbidden("Account not found for resident");
  }

  // Use default asset type for backward compatibility
  const defaultAssetTypeId = `${state.regionId}/credit` as AssetTypeId;

  const entry: LedgerEntry = {
    id: crypto.randomUUID(),
    fromAccountId: fromAccount.id,
    toAccountId: toAccount.id,
    assetTypeId: defaultAssetTypeId,
    amount,
    memo,
    seq: state.seq + 1,
    createdAt: command.meta.receivedAt,
  };

  const event: TransactionExecutedEvent = {
    type: "TransactionExecuted",
    entry,
    timestamp: command.meta.receivedAt,
  };

  return [event];
}

/**
 * Validate amount string format
 * Must be a positive decimal number with optional decimal places
 */
function isValidAmount(amount: string): boolean {
  // Must match positive decimal format
  const regex = /^[1-9]\d*(\.\d+)?$|^0\.\d*[1-9]\d*$/;
  return regex.test(amount);
}
