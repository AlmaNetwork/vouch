/**
 * Admit Command Handler
 *
 * Adds a new resident to the region.
 */

import type { CommandHandler, AdmitPayload, CommandContext, CommandResult } from "../registry.js";
import { DomainError } from "../../../domain/models/errors.js";
import {
  accountIdFromRaw,
  createResidentId,
  accountBelongsToRegion,
  type AccountId,
} from "../../../domain/models/almaId.js";
import type { Account, Resident, NetworkState } from "../../../domain/models/types.js";

export const admitHandler: CommandHandler<"admit"> = {
  name: "admit",

  validate(payload: AdmitPayload, ctx: CommandContext): void {
    // Region must be established
    if (ctx.state.regionId === "") {
      throw new DomainError(
        "NETWORK_NOT_FOUNDED",
        "Region has not been established",
        {}
      );
    }

    // Validate account ID format
    let accountId: AccountId;
    try {
      accountId = accountIdFromRaw(payload.accountId);
    } catch {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Invalid account ID format: ${payload.accountId}`,
        { field: "accountId" }
      );
    }

    // Check account belongs to this region
    if (!accountBelongsToRegion(accountId, ctx.state.regionId)) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Account does not belong to this region`,
        { field: "accountId", accountId: payload.accountId, regionId: ctx.state.regionId }
      );
    }

    // Check if account already exists
    if (ctx.state.accounts.has(accountId)) {
      throw new DomainError(
        "ACCOUNT_ALREADY_EXISTS",
        `Account already exists: ${payload.accountId}`,
        { accountId: payload.accountId }
      );
    }

    // Validate resident ID format
    try {
      createResidentId(payload.residentId);
    } catch {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Invalid resident ID format: ${payload.residentId}`,
        { field: "residentId" }
      );
    }

    // Check if resident already exists
    const residentId = createResidentId(payload.residentId);
    if (ctx.state.residents.has(residentId)) {
      throw new DomainError(
        "RESIDENT_ALREADY_EXISTS",
        `Resident already exists: ${payload.residentId}`,
        { residentId: payload.residentId }
      );
    }

    // Validate name
    if (!payload.name || payload.name.trim() === "") {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Resident name is required",
        { field: "name" }
      );
    }

    // Only owner can admit
    if (ctx.principal.accountId !== ctx.state.ownerId) {
      throw new DomainError(
        "FORBIDDEN",
        "Only the owner can admit residents",
        { principal: ctx.principal.accountId }
      );
    }
  },

  apply(payload: AdmitPayload, ctx: CommandContext): CommandResult {
    const accountId = accountIdFromRaw(payload.accountId);
    const residentId = createResidentId(payload.residentId);
    const now = ctx.now;

    // Create account
    const account: Account = {
      id: accountId,
      email: payload.email,
      regionId: ctx.state.regionId,
      residentId,
      roles: ["resident"],
      disabled: false,
      createdAt: now,
      updatedAt: now,
    };

    // Create resident
    const resident: Resident = {
      id: residentId,
      accountId,
      regionId: ctx.state.regionId,
      name: payload.name,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    // Clone and update state
    const newAccounts = new Map(ctx.state.accounts);
    newAccounts.set(accountId, account);

    const newResidents = new Map(ctx.state.residents);
    newResidents.set(residentId, resident);

    const newState: NetworkState = {
      ...ctx.state,
      accounts: newAccounts,
      residents: newResidents,
      seq: ctx.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "AccountCreated",
          payload: {
            accountId,
            email: payload.email,
            regionId: ctx.state.regionId,
            roles: ["resident"],
            createdAt: now,
          },
        },
        {
          type: "ResidentAdmitted",
          payload: {
            residentId,
            accountId,
            name: payload.name,
            regionId: ctx.state.regionId,
            createdAt: now,
          },
        },
      ],
      newState,
    };
  },
};
