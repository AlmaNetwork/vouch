/**
 * Transact Command Handler
 *
 * Executes a transaction between two accounts.
 */

import { type AccountId, type AssetTypeId, accountIdFromRaw, parseAssetId, parseAssetTypeId } from "../../../domain/models/almaId.js";
import { DomainError } from "../../../domain/models/errors.js";
import type { LedgerEntry, NetworkState } from "../../../domain/models/types.js";
import type { CommandContext, CommandHandler, CommandResult, TransactPayload } from "../registry.js";

export const transactHandler: CommandHandler<"transact"> = {
  name: "transact",

  validate(payload: TransactPayload, ctx: CommandContext): void {
    // Region must be established
    if (ctx.state.regionId === "") {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Region has not been established", {});
    }

    // Validate from account
    let fromAccountId: AccountId;
    try {
      fromAccountId = accountIdFromRaw(payload.from);
    } catch {
      throw new DomainError("VALIDATION_ERROR", `Invalid from account ID format: ${payload.from}`, { field: "from" });
    }

    // Validate to account
    let toAccountId: AccountId;
    try {
      toAccountId = accountIdFromRaw(payload.to);
    } catch {
      throw new DomainError("VALIDATION_ERROR", `Invalid to account ID format: ${payload.to}`, { field: "to" });
    }

    // Check self-transaction
    if (fromAccountId === toAccountId) {
      throw new DomainError("SELF_TRANSACTION", "Cannot transact with self", { from: payload.from, to: payload.to });
    }

    // Validate asset ID
    const parsedAsset = parseAssetId(payload.assetId);
    if (!parsedAsset) {
      // Also accept asset type ID format
      const parsedAssetType = parseAssetTypeId(payload.assetId);
      if (!parsedAssetType) {
        throw new DomainError("VALIDATION_ERROR", `Invalid asset ID format: ${payload.assetId}`, { field: "assetId" });
      }
    }

    // Check from account exists
    if (!ctx.state.accounts.has(fromAccountId)) {
      throw new DomainError("NOT_FOUND", `From account not found: ${payload.from}`, { field: "from", accountId: payload.from });
    }

    // Check to account exists
    if (!ctx.state.accounts.has(toAccountId)) {
      throw new DomainError("NOT_FOUND", `To account not found: ${payload.to}`, { field: "to", accountId: payload.to });
    }

    // Validate amount
    const amount = parseFloat(payload.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new DomainError("VALIDATION_ERROR", "Amount must be a positive number", { field: "amount", value: payload.amount });
    }

    // Authorization: principal must be from account owner or region owner
    const fromAccount = ctx.state.accounts.get(fromAccountId)!;
    const isOwner = ctx.principal.accountId === ctx.state.ownerId;
    const isFromAccountOwner = ctx.principal.accountId === fromAccount.id;

    if (!isOwner && !isFromAccountOwner) {
      throw new DomainError("FORBIDDEN", "Not authorized to transact from this account", {
        principal: ctx.principal.accountId,
        from: payload.from,
      });
    }
  },

  apply(payload: TransactPayload, ctx: CommandContext): CommandResult {
    const fromAccountId = accountIdFromRaw(payload.from);
    const toAccountId = accountIdFromRaw(payload.to);
    const now = ctx.now;

    // Derive asset type ID from asset ID
    let assetTypeId: AssetTypeId;
    const parsedAsset = parseAssetId(payload.assetId);
    if (parsedAsset) {
      // Full asset ID format: account@region/type#instance
      assetTypeId = `${parsedAsset.account.region.raw}/${parsedAsset.assetTypeName}` as AssetTypeId;
    } else {
      // Asset type ID format: region/type
      assetTypeId = payload.assetId as AssetTypeId;
    }

    // Create ledger entry
    const ledgerEntry: LedgerEntry = {
      id: crypto.randomUUID(),
      fromAccountId,
      toAccountId,
      assetTypeId,
      amount: payload.amount,
      memo: payload.memo || "",
      seq: ctx.seq + 1,
      createdAt: now,
    };

    // Clone and update state
    const newLedger = [...ctx.state.ledger, ledgerEntry];

    const newState: NetworkState = {
      ...ctx.state,
      ledger: newLedger,
      seq: ctx.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "TransactionExecuted",
          payload: {
            id: ledgerEntry.id,
            fromAccountId,
            toAccountId,
            assetTypeId,
            amount: payload.amount,
            memo: payload.memo || "",
            seq: ctx.seq + 1,
            createdAt: now,
          },
        },
      ],
      newState,
    };
  },
};
