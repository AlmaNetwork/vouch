/**
 * Asset Command Handlers
 *
 * Handlers for asset type and asset creation.
 */

import type {
  CommandHandler,
  CreateAssetTypePayload,
  CreateAssetPayload,
  CommandContext,
  CommandResult,
} from "../registry.js";
import { DomainError } from "../../../domain/models/errors.js";
import {
  parseAssetTypeId,
  parseAssetId,
  type AssetTypeId,
  type AssetId,
  type AccountId,
} from "../../../domain/models/almaId.js";
import type { NetworkState, AssetType, Asset } from "../../../domain/models/types.js";

// ============================================================
// Create Asset Type Handler
// ============================================================

export const createAssetTypeHandler: CommandHandler<"createAssetType"> = {
  name: "createAssetType",

  validate(payload: CreateAssetTypePayload, ctx: CommandContext): void {
    // Region must be established
    if (ctx.state.regionId === "") {
      throw new DomainError(
        "NETWORK_NOT_FOUNDED",
        "Region has not been established",
        {}
      );
    }

    // Validate asset type ID format
    const parsed = parseAssetTypeId(payload.assetTypeId);
    if (!parsed) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Invalid asset type ID format: ${payload.assetTypeId}`,
        { field: "assetTypeId" }
      );
    }

    // Asset type must belong to this region
    if (parsed.region.raw !== ctx.state.regionId) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Asset type must belong to this region",
        { field: "assetTypeId", expected: ctx.state.regionId, got: parsed.region.raw }
      );
    }

    // Check if asset type already exists
    const assetTypeId = payload.assetTypeId as AssetTypeId;
    if (ctx.state.assetTypes.has(assetTypeId)) {
      throw new DomainError(
        "ALREADY_EXISTS",
        `Asset type already exists: ${payload.assetTypeId}`,
        { assetTypeId: payload.assetTypeId }
      );
    }

    // Validate name
    if (!payload.name || payload.name.trim() === "") {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Asset type name is required",
        { field: "name" }
      );
    }

    // Only owner can create asset types
    if (ctx.principal.accountId !== ctx.state.ownerId) {
      throw new DomainError(
        "FORBIDDEN",
        "Only the owner can create asset types",
        { principal: ctx.principal.accountId }
      );
    }
  },

  apply(payload: CreateAssetTypePayload, ctx: CommandContext): CommandResult {
    const assetTypeId = payload.assetTypeId as AssetTypeId;
    const now = ctx.now;

    // Create asset type
    const assetType: AssetType = {
      id: assetTypeId,
      regionId: ctx.state.regionId,
      name: payload.name,
      description: payload.description || "",
      precision: payload.precision ?? 2,
      allowNegative: payload.allowNegative ?? false,
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
          type: "AssetTypeCreated",
          payload: {
            assetTypeId,
            regionId: ctx.state.regionId,
            name: payload.name,
            description: payload.description || "",
            precision: payload.precision ?? 2,
            allowNegative: payload.allowNegative ?? false,
            createdAt: now,
          },
        },
      ],
      newState,
    };
  },
};

// ============================================================
// Create Asset Handler
// ============================================================

export const createAssetHandler: CommandHandler<"createAsset"> = {
  name: "createAsset",

  validate(payload: CreateAssetPayload, ctx: CommandContext): void {
    // Region must be established
    if (ctx.state.regionId === "") {
      throw new DomainError(
        "NETWORK_NOT_FOUNDED",
        "Region has not been established",
        {}
      );
    }

    // Validate asset ID format
    const parsed = parseAssetId(payload.assetId);
    if (!parsed) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Invalid asset ID format: ${payload.assetId}`,
        { field: "assetId" }
      );
    }

    // Account must belong to this region
    if (parsed.account.region.raw !== ctx.state.regionId) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Asset account must belong to this region",
        { field: "assetId", expected: ctx.state.regionId, got: parsed.account.region.raw }
      );
    }

    // Account must exist
    const accountId = parsed.account.raw as AccountId;
    if (!ctx.state.accounts.has(accountId)) {
      throw new DomainError(
        "NOT_FOUND",
        `Account not found: ${parsed.account.raw}`,
        { field: "assetId", accountId: parsed.account.raw }
      );
    }

    // Asset type must exist
    const assetTypeId = `${parsed.account.region.raw}/${parsed.assetTypeName}` as AssetTypeId;
    if (!ctx.state.assetTypes.has(assetTypeId)) {
      throw new DomainError(
        "NOT_FOUND",
        `Asset type not found: ${assetTypeId}`,
        { field: "assetId", assetTypeId }
      );
    }

    // Check if asset already exists
    const assetId = payload.assetId as AssetId;
    if (ctx.state.assets.has(assetId)) {
      throw new DomainError(
        "ALREADY_EXISTS",
        `Asset already exists: ${payload.assetId}`,
        { assetId: payload.assetId }
      );
    }

    // Authorization: principal must be account owner or region owner
    const isOwner = ctx.principal.accountId === ctx.state.ownerId;
    const isAccountOwner = ctx.principal.accountId === accountId;

    if (!isOwner && !isAccountOwner) {
      throw new DomainError(
        "FORBIDDEN",
        "Not authorized to create asset for this account",
        { principal: ctx.principal.accountId, accountId }
      );
    }
  },

  apply(payload: CreateAssetPayload, ctx: CommandContext): CommandResult {
    const assetId = payload.assetId as AssetId;
    const parsed = parseAssetId(payload.assetId)!;
    const accountId = parsed.account.raw as AccountId;
    const assetTypeId = `${parsed.account.region.raw}/${parsed.assetTypeName}` as AssetTypeId;
    const now = ctx.now;

    // Create asset
    const asset: Asset = {
      id: assetId,
      accountId,
      assetTypeId,
      balance: payload.initialBalance || "0",
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
          type: "AssetCreated",
          payload: {
            assetId,
            accountId,
            assetTypeId,
            initialBalance: payload.initialBalance || "0",
            metadata: payload.metadata || {},
            createdAt: now,
          },
        },
      ],
      newState,
    };
  },
};
