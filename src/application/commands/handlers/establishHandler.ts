/**
 * Establish Command Handler
 *
 * Creates a new region with the requesting principal as owner.
 */

import type { CommandHandler, EstablishPayload, CommandContext, CommandResult } from "../registry.js";
import { DomainError } from "../../../domain/models/errors.js";
import {
  createRegionId,
  createAccountId,
  type RegionId,
} from "../../../domain/models/almaId.js";
import type { Account, NetworkState } from "../../../domain/models/types.js";

export const establishHandler: CommandHandler<"establish"> = {
  name: "establish",

  validate(payload: EstablishPayload, ctx: CommandContext): void {
    // Validate region ID format
    try {
      createRegionId(payload.regionId);
    } catch {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Invalid region ID format: ${payload.regionId}`,
        { field: "regionId" }
      );
    }

    // Check if region already exists
    if (ctx.state.regionId !== "" as RegionId) {
      throw new DomainError(
        "NETWORK_ALREADY_FOUNDED",
        "Region has already been established",
        { existingRegionId: ctx.state.regionId }
      );
    }

    // Validate name
    if (!payload.name || payload.name.trim() === "") {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Region name is required",
        { field: "name" }
      );
    }
  },

  apply(payload: EstablishPayload, ctx: CommandContext): CommandResult {
    const regionId = createRegionId(payload.regionId);
    const ownerId = createAccountId(ctx.principal.accountId.split("@")[0] || ctx.principal.accountId, regionId);
    const now = ctx.now;

    // Create owner account
    const ownerAccount: Account = {
      id: ownerId,
      email: "", // Will be set separately if needed
      regionId,
      residentId: null,
      roles: ["owner"],
      disabled: false,
      createdAt: now,
      updatedAt: now,
    };

    // Clone and update state
    const newAccounts = new Map(ctx.state.accounts);
    newAccounts.set(ownerId, ownerAccount);

    const newState: NetworkState = {
      ...ctx.state,
      regionId,
      ownerId,
      name: payload.name,
      accounts: newAccounts,
      seq: ctx.seq + 1,
      createdAt: now,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "RegionEstablished",
          payload: {
            regionId: payload.regionId,
            name: payload.name,
            ownerId: ownerId,
            ownerEmail: "",
            createdAt: now,
          },
        },
        {
          type: "AccountCreated",
          payload: {
            accountId: ownerId,
            email: "",
            regionId: payload.regionId,
            roles: ["owner"],
            createdAt: now,
          },
        },
      ],
      newState,
    };
  },
};
