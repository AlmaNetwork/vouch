/**
 * Asset Command Handlers
 *
 * Handlers for asset type definition and asset lifecycle management.
 */

import {
  type AccountId,
  type AssetId,
  type AssetTypeId,
  parseAccountId,
  parseAssetId,
  parseAssetTypeId,
} from "../../../domain/models/almaId.js";
import { DomainError } from "../../../domain/models/errors.js";
import type { Asset, AssetType, NetworkState } from "../../../domain/models/types.js";
import type {
  CommandContext,
  CommandHandler,
  CommandResult,
  DefineAssetTypePayload,
  DisposeAssetPayload,
  IssueAssetPayload,
  RevokeAssetPayload,
  TransferAssetPayload,
} from "../registry.js";

// ============================================================
// Define Asset Type Handler
// ============================================================

export const defineAssetTypeHandler: CommandHandler<"defineAssetType"> = {
  name: "defineAssetType",

  validate(payload: DefineAssetTypePayload, ctx: CommandContext): void {
    // Region must be established
    if (ctx.state.regionId === "") {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Region has not been established", {});
    }

    // Validate asset type ID format
    const parsed = parseAssetTypeId(payload.assetTypeId);
    if (!parsed) {
      throw new DomainError("VALIDATION_ERROR", `Invalid asset type ID format: ${payload.assetTypeId}`, { field: "assetTypeId" });
    }

    // Asset type must belong to this region
    if (parsed.region.raw !== ctx.state.regionId) {
      throw new DomainError("VALIDATION_ERROR", "Asset type must belong to this region", {
        field: "assetTypeId",
        expected: ctx.state.regionId,
        got: parsed.region.raw,
      });
    }

    // Check if asset type already exists
    const assetTypeId = payload.assetTypeId as AssetTypeId;
    if (ctx.state.assetTypes.has(assetTypeId)) {
      throw new DomainError("ALREADY_EXISTS", `Asset type already exists: ${payload.assetTypeId}`, { assetTypeId: payload.assetTypeId });
    }

    // Validate name
    if (!payload.name || payload.name.trim() === "") {
      throw new DomainError("VALIDATION_ERROR", "Asset type name is required", { field: "name" });
    }

    // Only owner or admin can define asset types
    const isOwner = ctx.principal.accountId === ctx.state.ownerId;
    const isAdmin = ctx.principal.roles.includes("admin");
    if (!isOwner && !isAdmin) {
      throw new DomainError("FORBIDDEN", "Only owner or admin can define asset types", { principal: ctx.principal.accountId });
    }
  },

  apply(payload: DefineAssetTypePayload, ctx: CommandContext): CommandResult {
    const assetTypeId = payload.assetTypeId as AssetTypeId;
    const now = ctx.now;

    // Determine defaults based on kind
    const transferable = payload.transferable ?? payload.kind === "fungible";
    const expirable = payload.expirable ?? false;

    // Create asset type
    const assetType: AssetType = {
      id: assetTypeId,
      regionId: ctx.state.regionId,
      name: payload.name,
      description: payload.description || "",
      kind: payload.kind,
      precision: payload.precision ?? 0,
      allowNegative: payload.allowNegative ?? false,
      schema: payload.schema || null,
      transferable,
      expirable,
      issuerId: ctx.principal.accountId,
      createdAt: now,
      updatedAt: now,
    };

    // Clone and update state
    const newAssetTypes = new Map(ctx.state.assetTypes);
    newAssetTypes.set(assetTypeId, assetType);

    const newState: NetworkState = {
      ...ctx.state,
      assetTypes: newAssetTypes,
      seq: ctx.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "AssetTypeDefined",
          payload: {
            assetTypeId,
            regionId: ctx.state.regionId,
            issuerId: ctx.principal.accountId,
            name: payload.name,
            description: payload.description || "",
            kind: payload.kind,
            precision: payload.precision ?? 0,
            allowNegative: payload.allowNegative ?? false,
            schema: payload.schema || null,
            transferable,
            expirable,
            createdAt: now,
          },
        },
      ],
      newState,
    };
  },
};

// ============================================================
// Issue Asset Handler
// ============================================================

export const issueAssetHandler: CommandHandler<"issueAsset"> = {
  name: "issueAsset",

  validate(payload: IssueAssetPayload, ctx: CommandContext): void {
    // Region must be established
    if (ctx.state.regionId === "") {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Region has not been established", {});
    }

    // Validate asset ID format
    const parsed = parseAssetId(payload.assetId);
    if (!parsed) {
      throw new DomainError("VALIDATION_ERROR", `Invalid asset ID format: ${payload.assetId}`, { field: "assetId" });
    }

    // Validate recipient ID format
    const recipientParsed = parseAccountId(payload.recipientId);
    if (!recipientParsed) {
      throw new DomainError("VALIDATION_ERROR", `Invalid recipient ID format: ${payload.recipientId}`, { field: "recipientId" });
    }

    // Recipient must exist
    const recipientId = payload.recipientId as AccountId;
    if (!ctx.state.accounts.has(recipientId)) {
      throw new DomainError("NOT_FOUND", `Recipient account not found: ${payload.recipientId}`, { field: "recipientId" });
    }

    // Asset type must exist
    const assetTypeId = `${parsed.account.region.raw}/${parsed.assetTypeName}` as AssetTypeId;
    const assetType = ctx.state.assetTypes.get(assetTypeId);
    if (!assetType) {
      throw new DomainError("NOT_FOUND", `Asset type not found: ${assetTypeId}`, { field: "assetId", assetTypeId });
    }

    // Check if asset already exists
    const assetId = payload.assetId as AssetId;
    if (ctx.state.assets.has(assetId)) {
      throw new DomainError("ALREADY_EXISTS", `Asset already exists: ${payload.assetId}`, { assetId: payload.assetId });
    }

    // Authorization: principal must be the issuer of the asset type
    if (ctx.principal.accountId !== assetType.issuerId) {
      throw new DomainError("FORBIDDEN", "Only the asset type issuer can issue assets", {
        principal: ctx.principal.accountId,
        issuerId: assetType.issuerId,
      });
    }

    // Validate amount for fungible assets
    if (assetType.kind === "fungible") {
      if (!payload.amount) {
        throw new DomainError("VALIDATION_ERROR", "Amount is required for fungible assets", { field: "amount" });
      }
      // Validate amount is a valid number
      const amount = parseFloat(payload.amount);
      if (isNaN(amount) || amount < 0) {
        throw new DomainError("VALIDATION_ERROR", "Amount must be a non-negative number", { field: "amount" });
      }
    }
  },

  apply(payload: IssueAssetPayload, ctx: CommandContext): CommandResult {
    const assetId = payload.assetId as AssetId;
    const parsed = parseAssetId(payload.assetId)!;
    const recipientId = payload.recipientId as AccountId;
    const assetTypeId = `${parsed.account.region.raw}/${parsed.assetTypeName}` as AssetTypeId;
    const now = ctx.now;

    // Create asset
    const asset: Asset = {
      id: assetId,
      accountId: recipientId,
      assetTypeId,
      issuerId: ctx.principal.accountId,
      balance: payload.amount || "0",
      claims: payload.claims || null,
      expiresAt: payload.expiresAt || null,
      status: "active",
      metadata: payload.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    // Clone and update state
    const newAssets = new Map(ctx.state.assets);
    newAssets.set(assetId, asset);

    const newState: NetworkState = {
      ...ctx.state,
      assets: newAssets,
      seq: ctx.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "AssetIssued",
          payload: {
            assetId,
            accountId: recipientId,
            assetTypeId,
            issuerId: ctx.principal.accountId,
            balance: payload.amount || "0",
            claims: payload.claims || null,
            expiresAt: payload.expiresAt || null,
            metadata: payload.metadata || {},
            createdAt: now,
          },
        },
      ],
      newState,
    };
  },
};

// ============================================================
// Transfer Asset Handler
// ============================================================

export const transferAssetHandler: CommandHandler<"transferAsset"> = {
  name: "transferAsset",

  validate(payload: TransferAssetPayload, ctx: CommandContext): void {
    // Region must be established
    if (ctx.state.regionId === "") {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Region has not been established", {});
    }

    // Asset must exist
    const assetId = payload.assetId as AssetId;
    const asset = ctx.state.assets.get(assetId);
    if (!asset) {
      throw new DomainError("NOT_FOUND", `Asset not found: ${payload.assetId}`, { assetId: payload.assetId });
    }

    // Asset must be active
    if (asset.status !== "active") {
      throw new DomainError("VALIDATION_ERROR", `Asset is not active: ${asset.status}`, { assetId: payload.assetId, status: asset.status });
    }

    // Asset type must exist and be transferable
    const assetType = ctx.state.assetTypes.get(asset.assetTypeId);
    if (!assetType) {
      throw new DomainError("NOT_FOUND", `Asset type not found: ${asset.assetTypeId}`, { assetTypeId: asset.assetTypeId });
    }

    if (!assetType.transferable) {
      throw new DomainError("FORBIDDEN", "This asset type is not transferable", { assetTypeId: asset.assetTypeId });
    }

    // Recipient must exist
    const toAccountId = payload.toAccountId as AccountId;
    if (!ctx.state.accounts.has(toAccountId)) {
      throw new DomainError("NOT_FOUND", `Recipient account not found: ${payload.toAccountId}`, { field: "toAccountId" });
    }

    // Cannot transfer to self
    if (asset.accountId === toAccountId) {
      throw new DomainError("SELF_TRANSACTION", "Cannot transfer asset to self", { from: asset.accountId, to: toAccountId });
    }

    // Authorization: principal must be the asset owner
    if (ctx.principal.accountId !== asset.accountId) {
      throw new DomainError("FORBIDDEN", "Only the asset owner can transfer it", {
        principal: ctx.principal.accountId,
        owner: asset.accountId,
      });
    }

    // Validate amount for fungible partial transfers
    if (assetType.kind === "fungible" && payload.amount) {
      const transferAmount = parseFloat(payload.amount);
      const currentBalance = parseFloat(asset.balance);
      if (isNaN(transferAmount) || transferAmount <= 0) {
        throw new DomainError("VALIDATION_ERROR", "Transfer amount must be a positive number", { field: "amount" });
      }
      if (transferAmount > currentBalance && !assetType.allowNegative) {
        throw new DomainError("INSUFFICIENT_BALANCE", "Insufficient balance for transfer", {
          balance: asset.balance,
          amount: payload.amount,
        });
      }
    }
  },

  apply(payload: TransferAssetPayload, ctx: CommandContext): CommandResult {
    const assetId = payload.assetId as AssetId;
    const asset = ctx.state.assets.get(assetId)!;
    const assetType = ctx.state.assetTypes.get(asset.assetTypeId)!;
    const toAccountId = payload.toAccountId as AccountId;
    const now = ctx.now;

    const newAssets = new Map(ctx.state.assets);

    // For non-fungible or full transfer: just change owner
    // For fungible partial transfer: split the asset
    if (assetType.kind === "fungible" && payload.amount) {
      const transferAmount = parseFloat(payload.amount);
      const currentBalance = parseFloat(asset.balance);
      const newBalance = currentBalance - transferAmount;

      // Update source asset balance
      const updatedSourceAsset: Asset = {
        ...asset,
        balance: newBalance.toString(),
        updatedAt: now,
      };
      newAssets.set(assetId, updatedSourceAsset);

      // Create or update destination asset
      // For simplicity, we'll create a new asset entry with a derived ID
      // In practice, you might aggregate balances
      const destAssetId = `${toAccountId}/${assetType.id.split("/")[1]}#transfer-${ctx.seq}` as AssetId;
      const destAsset: Asset = {
        id: destAssetId,
        accountId: toAccountId,
        assetTypeId: asset.assetTypeId,
        issuerId: asset.issuerId,
        balance: payload.amount,
        claims: null,
        expiresAt: null,
        status: "active",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };
      newAssets.set(destAssetId, destAsset);
    } else {
      // Full transfer: change owner
      const updatedAsset: Asset = {
        ...asset,
        accountId: toAccountId,
        updatedAt: now,
      };
      newAssets.set(assetId, updatedAsset);
    }

    const newState: NetworkState = {
      ...ctx.state,
      assets: newAssets,
      seq: ctx.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "AssetTransferred",
          payload: {
            assetId,
            fromAccountId: asset.accountId,
            toAccountId,
            amount: payload.amount || null,
            memo: payload.memo || "",
            createdAt: now,
          },
        },
      ],
      newState,
    };
  },
};

// ============================================================
// Dispose Asset Handler
// ============================================================

export const disposeAssetHandler: CommandHandler<"disposeAsset"> = {
  name: "disposeAsset",

  validate(payload: DisposeAssetPayload, ctx: CommandContext): void {
    // Region must be established
    if (ctx.state.regionId === "") {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Region has not been established", {});
    }

    // Asset must exist
    const assetId = payload.assetId as AssetId;
    const asset = ctx.state.assets.get(assetId);
    if (!asset) {
      throw new DomainError("NOT_FOUND", `Asset not found: ${payload.assetId}`, { assetId: payload.assetId });
    }

    // Asset must be active
    if (asset.status !== "active") {
      throw new DomainError("VALIDATION_ERROR", `Asset is not active: ${asset.status}`, { assetId: payload.assetId, status: asset.status });
    }

    // Authorization: principal must be the asset owner
    if (ctx.principal.accountId !== asset.accountId) {
      throw new DomainError("FORBIDDEN", "Only the asset owner can dispose it", {
        principal: ctx.principal.accountId,
        owner: asset.accountId,
      });
    }
  },

  apply(payload: DisposeAssetPayload, ctx: CommandContext): CommandResult {
    const assetId = payload.assetId as AssetId;
    const asset = ctx.state.assets.get(assetId)!;
    const now = ctx.now;

    // Update asset status to disposed
    const updatedAsset: Asset = {
      ...asset,
      status: "disposed",
      updatedAt: now,
    };

    const newAssets = new Map(ctx.state.assets);
    newAssets.set(assetId, updatedAsset);

    const newState: NetworkState = {
      ...ctx.state,
      assets: newAssets,
      seq: ctx.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "AssetDisposed",
          payload: {
            assetId,
            accountId: asset.accountId,
            reason: payload.reason || "",
            disposedAt: now,
          },
        },
      ],
      newState,
    };
  },
};

// ============================================================
// Revoke Asset Handler
// ============================================================

export const revokeAssetHandler: CommandHandler<"revokeAsset"> = {
  name: "revokeAsset",

  validate(payload: RevokeAssetPayload, ctx: CommandContext): void {
    // Region must be established
    if (ctx.state.regionId === "") {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Region has not been established", {});
    }

    // Asset must exist
    const assetId = payload.assetId as AssetId;
    const asset = ctx.state.assets.get(assetId);
    if (!asset) {
      throw new DomainError("NOT_FOUND", `Asset not found: ${payload.assetId}`, { assetId: payload.assetId });
    }

    // Asset must be active
    if (asset.status !== "active") {
      throw new DomainError("VALIDATION_ERROR", `Asset is not active: ${asset.status}`, { assetId: payload.assetId, status: asset.status });
    }

    // Reason is required
    if (!payload.reason || payload.reason.trim() === "") {
      throw new DomainError("VALIDATION_ERROR", "Reason is required for revocation", { field: "reason" });
    }

    // Authorization: principal must be the asset issuer
    if (ctx.principal.accountId !== asset.issuerId) {
      throw new DomainError("FORBIDDEN", "Only the asset issuer can revoke it", {
        principal: ctx.principal.accountId,
        issuer: asset.issuerId,
      });
    }
  },

  apply(payload: RevokeAssetPayload, ctx: CommandContext): CommandResult {
    const assetId = payload.assetId as AssetId;
    const asset = ctx.state.assets.get(assetId)!;
    const now = ctx.now;

    // Update asset status to revoked
    const updatedAsset: Asset = {
      ...asset,
      status: "revoked",
      updatedAt: now,
    };

    const newAssets = new Map(ctx.state.assets);
    newAssets.set(assetId, updatedAsset);

    const newState: NetworkState = {
      ...ctx.state,
      assets: newAssets,
      seq: ctx.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "AssetRevoked",
          payload: {
            assetId,
            issuerId: ctx.principal.accountId,
            reason: payload.reason,
            revokedAt: now,
          },
        },
      ],
      newState,
    };
  },
};
