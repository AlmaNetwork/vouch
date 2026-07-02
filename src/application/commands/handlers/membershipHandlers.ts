/**
 * Membership Command Handlers
 *
 * Handlers for membership-related commands:
 * - invite: Create an invitation to join the network
 * - acceptInvite: Accept an invitation and create account/resident
 * - suspend: Suspend an account
 * - reinstate: Reinstate a suspended account
 */

import { parseAccountId, parseInviteId, parseResidentId } from "../../../domain/models/almaId.js";
import { DomainError } from "../../../domain/models/errors.js";
import type { Account, AccountId, Invite, InviteId, Resident, ResidentId, Role } from "../../../domain/models/types.js";
import { getAccount, getInvite, hasAccount, hasInvite, isNetworkFounded } from "../../../domain/models/types.js";
import type {
  AcceptInvitePayload,
  CommandContext,
  CommandHandler,
  CommandResult,
  InvitePayload,
  ReinstatePayload,
  SuspendPayload,
} from "../registry.js";

// Default invite expiration in days
const DEFAULT_INVITE_EXPIRATION_DAYS = 7;

// ============================================================
// invite Handler
// ============================================================

export const inviteHandler: CommandHandler<"invite"> = {
  name: "invite",

  validate(payload: InvitePayload, ctx: CommandContext): void {
    const { state, principal } = ctx;

    // Network must be founded
    if (!isNetworkFounded(state)) {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Cannot create invite: network not founded");
    }

    // Only owner or admin can create invites
    if (!principal.roles.includes("owner") && !principal.roles.includes("admin")) {
      throw new DomainError("FORBIDDEN", "Only owner or admin can create invites");
    }

    // Validate email format
    if (!payload.email || !payload.email.includes("@")) {
      throw new DomainError("VALIDATION_ERROR", "Invalid email address", { email: payload.email });
    }

    // If inviteId provided, validate and check uniqueness
    if (payload.inviteId) {
      const parsed = parseInviteId(payload.inviteId);
      if (!parsed) {
        throw new DomainError("VALIDATION_ERROR", `Invalid invite ID format: ${payload.inviteId}`, { inviteId: payload.inviteId });
      }

      if (hasInvite(state, payload.inviteId as InviteId)) {
        throw new DomainError("ALREADY_EXISTS", `Invite already exists: ${payload.inviteId}`, { inviteId: payload.inviteId });
      }
    }

    // Validate roles if provided
    const validRoles: Role[] = ["resident", "admin"];
    if (payload.roles) {
      for (const role of payload.roles) {
        if (!validRoles.includes(role as Role)) {
          throw new DomainError("VALIDATION_ERROR", `Invalid role: ${role}. Valid roles are: ${validRoles.join(", ")}`, { role });
        }
      }
    }
  },

  apply(payload: InvitePayload, ctx: CommandContext): CommandResult {
    const { state, principal, now } = ctx;

    // Generate invite ID if not provided
    const inviteId = (payload.inviteId || crypto.randomUUID()) as InviteId;

    // Calculate expiration
    const expiresInDays = payload.expiresInDays || DEFAULT_INVITE_EXPIRATION_DAYS;
    const expiresAt = new Date(new Date(now).getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    // Default to resident role
    const roles: Role[] = (payload.roles as Role[]) || ["resident"];

    const invite: Invite = {
      id: inviteId,
      regionId: state.regionId,
      email: payload.email,
      invitedBy: principal.accountId,
      roles,
      status: "pending",
      expiresAt,
      acceptedAt: null,
      acceptedAccountId: null,
      createdAt: now,
      updatedAt: now,
    };

    const newInvites = new Map(state.invites);
    newInvites.set(inviteId, invite);

    const newState = {
      ...state,
      invites: newInvites,
      seq: state.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "InviteCreated",
          payload: {
            inviteId,
            regionId: state.regionId,
            email: payload.email,
            invitedBy: principal.accountId,
            roles,
            expiresAt,
            createdAt: now,
          },
        },
      ],
      newState,
    };
  },
};

// ============================================================
// acceptInvite Handler
// ============================================================

export const acceptInviteHandler: CommandHandler<"acceptInvite"> = {
  name: "acceptInvite",

  validate(payload: AcceptInvitePayload, ctx: CommandContext): void {
    const { state, now } = ctx;

    // Network must be founded
    if (!isNetworkFounded(state)) {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Cannot accept invite: network not founded");
    }

    // Validate invite ID
    const parsedInvite = parseInviteId(payload.inviteId);
    if (!parsedInvite) {
      throw new DomainError("VALIDATION_ERROR", `Invalid invite ID format: ${payload.inviteId}`, { inviteId: payload.inviteId });
    }

    // Invite must exist
    const invite = getInvite(state, payload.inviteId as InviteId);
    if (!invite) {
      throw new DomainError("NOT_FOUND", `Invite not found: ${payload.inviteId}`, { inviteId: payload.inviteId });
    }

    // Invite must be pending
    if (invite.status !== "pending") {
      throw new DomainError("VALIDATION_ERROR", `Invite is not pending: ${payload.inviteId}`, {
        inviteId: payload.inviteId,
        status: invite.status,
      });
    }

    // Invite must not be expired
    if (new Date(invite.expiresAt) < new Date(now)) {
      throw new DomainError("VALIDATION_ERROR", `Invite has expired: ${payload.inviteId}`, {
        inviteId: payload.inviteId,
        expiresAt: invite.expiresAt,
      });
    }

    // Validate account ID format
    const parsedAccount = parseAccountId(payload.accountId);
    if (!parsedAccount) {
      throw new DomainError("VALIDATION_ERROR", `Invalid account ID format: ${payload.accountId}`, { accountId: payload.accountId });
    }

    // Account must not already exist
    if (hasAccount(state, payload.accountId as AccountId)) {
      throw new DomainError("ALREADY_EXISTS", `Account already exists: ${payload.accountId}`, { accountId: payload.accountId });
    }

    // Validate resident ID format
    const parsedResident = parseResidentId(payload.residentId);
    if (!parsedResident) {
      throw new DomainError("VALIDATION_ERROR", `Invalid resident ID format: ${payload.residentId}`, { residentId: payload.residentId });
    }

    // Resident must not already exist
    if (state.residents.has(payload.residentId as ResidentId)) {
      throw new DomainError("ALREADY_EXISTS", `Resident already exists: ${payload.residentId}`, { residentId: payload.residentId });
    }
  },

  apply(payload: AcceptInvitePayload, ctx: CommandContext): CommandResult {
    const { state, now } = ctx;
    const inviteId = payload.inviteId as InviteId;
    const accountId = payload.accountId as AccountId;
    const residentId = payload.residentId as ResidentId;

    const invite = getInvite(state, inviteId)!;

    // Update invite status
    const updatedInvite: Invite = {
      ...invite,
      status: "accepted",
      acceptedAt: now,
      acceptedAccountId: accountId,
      updatedAt: now,
    };

    // Create account
    const account: Account = {
      id: accountId,
      email: invite.email,
      regionId: state.regionId,
      residentId,
      roles: invite.roles,
      disabled: false,
      createdAt: now,
      updatedAt: now,
    };

    // Create resident
    const resident: Resident = {
      id: residentId,
      accountId,
      regionId: state.regionId,
      name: payload.residentName,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    const newInvites = new Map(state.invites);
    newInvites.set(inviteId, updatedInvite);

    const newAccounts = new Map(state.accounts);
    newAccounts.set(accountId, account);

    const newResidents = new Map(state.residents);
    newResidents.set(residentId, resident);

    const newState = {
      ...state,
      invites: newInvites,
      accounts: newAccounts,
      residents: newResidents,
      seq: state.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "InviteAccepted",
          payload: {
            inviteId,
            accountId,
            residentId,
            residentName: payload.residentName,
            email: invite.email,
            acceptedAt: now,
          },
        },
        {
          type: "AccountCreated",
          payload: {
            accountId,
            email: invite.email,
            regionId: state.regionId,
            roles: invite.roles,
            createdAt: now,
          },
        },
        {
          type: "ResidentAdmitted",
          payload: {
            residentId,
            accountId,
            name: payload.residentName,
            regionId: state.regionId,
            createdAt: now,
          },
        },
      ],
      newState,
    };
  },
};

// ============================================================
// suspend Handler
// ============================================================

export const suspendHandler: CommandHandler<"suspend"> = {
  name: "suspend",

  validate(payload: SuspendPayload, ctx: CommandContext): void {
    const { state, principal } = ctx;

    // Network must be founded
    if (!isNetworkFounded(state)) {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Cannot suspend account: network not founded");
    }

    // Only owner or admin can suspend accounts
    if (!principal.roles.includes("owner") && !principal.roles.includes("admin")) {
      throw new DomainError("FORBIDDEN", "Only owner or admin can suspend accounts");
    }

    // Cannot suspend self
    if (payload.accountId === principal.accountId) {
      throw new DomainError("VALIDATION_ERROR", "Cannot suspend your own account");
    }

    // Account must exist
    const account = getAccount(state, payload.accountId as AccountId);
    if (!account) {
      throw new DomainError("NOT_FOUND", `Account not found: ${payload.accountId}`, { accountId: payload.accountId });
    }

    // Cannot suspend owner (only owner can suspend others, not be suspended)
    if (account.roles.includes("owner")) {
      throw new DomainError("FORBIDDEN", "Cannot suspend the network owner");
    }

    // Account must not already be disabled
    if (account.disabled) {
      throw new DomainError("VALIDATION_ERROR", `Account already suspended: ${payload.accountId}`, { accountId: payload.accountId });
    }

    // Reason is required
    if (!payload.reason || payload.reason.trim() === "") {
      throw new DomainError("VALIDATION_ERROR", "Reason is required for suspending an account");
    }
  },

  apply(payload: SuspendPayload, ctx: CommandContext): CommandResult {
    const { state, principal, now } = ctx;
    const accountId = payload.accountId as AccountId;

    const existingAccount = getAccount(state, accountId)!;

    const suspendedAccount: Account = {
      ...existingAccount,
      disabled: true,
      updatedAt: now,
    };

    const newAccounts = new Map(state.accounts);
    newAccounts.set(accountId, suspendedAccount);

    // Also update resident status if exists
    let newResidents = state.residents;
    if (existingAccount.residentId) {
      const resident = state.residents.get(existingAccount.residentId);
      if (resident) {
        const suspendedResident: Resident = {
          ...resident,
          status: "suspended",
          updatedAt: now,
        };
        newResidents = new Map(state.residents);
        newResidents.set(existingAccount.residentId, suspendedResident);
      }
    }

    const newState = {
      ...state,
      accounts: newAccounts,
      residents: newResidents,
      seq: state.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "AccountSuspended",
          payload: {
            accountId,
            suspendedBy: principal.accountId,
            reason: payload.reason,
            suspendedAt: now,
          },
        },
      ],
      newState,
    };
  },
};

// ============================================================
// reinstate Handler
// ============================================================

export const reinstateHandler: CommandHandler<"reinstate"> = {
  name: "reinstate",

  validate(payload: ReinstatePayload, ctx: CommandContext): void {
    const { state, principal } = ctx;

    // Network must be founded
    if (!isNetworkFounded(state)) {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Cannot reinstate account: network not founded");
    }

    // Only owner or admin can reinstate accounts
    if (!principal.roles.includes("owner") && !principal.roles.includes("admin")) {
      throw new DomainError("FORBIDDEN", "Only owner or admin can reinstate accounts");
    }

    // Account must exist
    const account = getAccount(state, payload.accountId as AccountId);
    if (!account) {
      throw new DomainError("NOT_FOUND", `Account not found: ${payload.accountId}`, { accountId: payload.accountId });
    }

    // Account must be disabled
    if (!account.disabled) {
      throw new DomainError("VALIDATION_ERROR", `Account is not suspended: ${payload.accountId}`, { accountId: payload.accountId });
    }
  },

  apply(payload: ReinstatePayload, ctx: CommandContext): CommandResult {
    const { state, principal, now } = ctx;
    const accountId = payload.accountId as AccountId;

    const existingAccount = getAccount(state, accountId)!;

    const reinstatedAccount: Account = {
      ...existingAccount,
      disabled: false,
      updatedAt: now,
    };

    const newAccounts = new Map(state.accounts);
    newAccounts.set(accountId, reinstatedAccount);

    // Also update resident status if exists
    let newResidents = state.residents;
    if (existingAccount.residentId) {
      const resident = state.residents.get(existingAccount.residentId);
      if (resident) {
        const reinstatedResident: Resident = {
          ...resident,
          status: "active",
          updatedAt: now,
        };
        newResidents = new Map(state.residents);
        newResidents.set(existingAccount.residentId, reinstatedResident);
      }
    }

    const newState = {
      ...state,
      accounts: newAccounts,
      residents: newResidents,
      seq: state.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "AccountReinstated",
          payload: {
            accountId,
            reinstatedBy: principal.accountId,
            reason: payload.reason || "",
            reinstatedAt: now,
          },
        },
      ],
      newState,
    };
  },
};
