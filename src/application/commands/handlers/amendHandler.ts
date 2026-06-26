/**
 * Amend Command Handler
 *
 * Modifies region settings.
 */

import type { CommandHandler, AmendPayload, CommandContext, CommandResult } from "../registry.js";
import { DomainError } from "../../../domain/models/errors.js";
import { accountIdFromRaw, type AccountId } from "../../../domain/models/almaId.js";
import type { NetworkState } from "../../../domain/models/types.js";

export const amendHandler: CommandHandler<"amend"> = {
  name: "amend",

  validate(payload: AmendPayload, ctx: CommandContext): void {
    // Region must be established
    if (ctx.state.regionId === "") {
      throw new DomainError(
        "NETWORK_NOT_FOUNDED",
        "Region has not been established",
        {}
      );
    }

    // Only owner can amend
    if (ctx.principal.accountId !== ctx.state.ownerId) {
      throw new DomainError(
        "FORBIDDEN",
        "Only the owner can amend region settings",
        { principal: ctx.principal.accountId }
      );
    }

    // Validate changes
    if (!payload.changes || Object.keys(payload.changes).length === 0) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "No changes provided",
        { field: "changes" }
      );
    }

    // Validate new owner if specified
    if (payload.changes.ownerId) {
      let newOwnerId: AccountId;
      try {
        newOwnerId = accountIdFromRaw(payload.changes.ownerId);
      } catch {
        throw new DomainError(
          "VALIDATION_ERROR",
          `Invalid owner ID format: ${payload.changes.ownerId}`,
          { field: "ownerId" }
        );
      }

      // New owner must exist
      if (!ctx.state.accounts.has(newOwnerId)) {
        throw new DomainError(
          "NOT_FOUND",
          `Account not found: ${payload.changes.ownerId}`,
          { field: "ownerId", accountId: payload.changes.ownerId }
        );
      }
    }
  },

  apply(payload: AmendPayload, ctx: CommandContext): CommandResult {
    const now = ctx.now;
    const changes: Record<string, unknown> = {};

    let newState: NetworkState = {
      ...ctx.state,
      seq: ctx.seq + 1,
      updatedAt: now,
    };

    // Apply changes
    if (payload.changes.ownerId) {
      const newOwnerId = accountIdFromRaw(payload.changes.ownerId);
      newState = { ...newState, ownerId: newOwnerId };
      changes.ownerId = newOwnerId;
    }

    if (payload.changes.name !== undefined) {
      newState = { ...newState, name: payload.changes.name };
      changes.name = payload.changes.name;
    }

    return {
      events: [
        {
          type: "RegionAmended",
          payload: {
            changes,
            updatedAt: now,
          },
        },
      ],
      newState,
    };
  },
};
