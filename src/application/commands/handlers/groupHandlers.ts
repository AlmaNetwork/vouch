/**
 * Group Command Handlers
 *
 * Handlers for organization-related commands:
 * - makeGroup: Create a new group
 * - reviseGroup: Modify an existing group
 * - dissolveGroup: Dissolve a group
 * - assignMember: Add, remove, or update a member in a group
 */

import { parseGroupId } from "../../../domain/models/almaId.js";
import { DomainError } from "../../../domain/models/errors.js";
import type { AccountId, Group, GroupId, GroupMember, GroupMemberRole, GroupType } from "../../../domain/models/types.js";
import { getGroup, hasAccount, hasGroup, isNetworkFounded } from "../../../domain/models/types.js";
import type {
  AssignMemberPayload,
  CommandContext,
  CommandHandler,
  CommandResult,
  DissolveGroupPayload,
  MakeGroupPayload,
  ReviseGroupPayload,
} from "../registry.js";

// ============================================================
// makeGroup Handler
// ============================================================

export const makeGroupHandler: CommandHandler<"makeGroup"> = {
  name: "makeGroup",

  validate(payload: MakeGroupPayload, ctx: CommandContext): void {
    const { state, principal } = ctx;

    // Network must be founded
    if (!isNetworkFounded(state)) {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Cannot create group: network not founded");
    }

    // Only owner or admin can create groups
    if (!principal.roles.includes("owner") && !principal.roles.includes("admin")) {
      throw new DomainError("FORBIDDEN", "Only owner or admin can create groups");
    }

    // Validate group ID format
    const parsed = parseGroupId(payload.groupId);
    if (!parsed) {
      throw new DomainError("VALIDATION_ERROR", `Invalid group ID format: ${payload.groupId}`, { groupId: payload.groupId });
    }

    // Group ID must belong to this region
    if (parsed.region.raw !== state.regionId) {
      throw new DomainError("VALIDATION_ERROR", "Group ID must belong to this region", {
        groupId: payload.groupId,
        regionId: state.regionId,
      });
    }

    // Group must not already exist
    if (hasGroup(state, payload.groupId as GroupId)) {
      throw new DomainError("ALREADY_EXISTS", `Group already exists: ${payload.groupId}`, { groupId: payload.groupId });
    }
  },

  apply(payload: MakeGroupPayload, ctx: CommandContext): CommandResult {
    const { state, principal, now } = ctx;
    const groupId = payload.groupId as GroupId;

    // Creator becomes the leader
    const initialMember: GroupMember = {
      accountId: principal.accountId,
      role: "leader",
      joinedAt: now,
    };

    const group: Group = {
      id: groupId,
      regionId: state.regionId,
      name: payload.name,
      description: payload.description || "",
      groupType: payload.groupType as GroupType,
      members: [initialMember],
      permissions: payload.permissions || [],
      createdBy: principal.accountId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    const newGroups = new Map(state.groups);
    newGroups.set(groupId, group);

    const newState = {
      ...state,
      groups: newGroups,
      seq: state.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "GroupCreated",
          payload: {
            groupId: payload.groupId,
            regionId: state.regionId,
            createdBy: principal.accountId,
            name: payload.name,
            description: payload.description || "",
            groupType: payload.groupType,
            permissions: payload.permissions || [],
            createdAt: now,
          },
        },
      ],
      newState,
    };
  },
};

// ============================================================
// reviseGroup Handler
// ============================================================

export const reviseGroupHandler: CommandHandler<"reviseGroup"> = {
  name: "reviseGroup",

  validate(payload: ReviseGroupPayload, ctx: CommandContext): void {
    const { state, principal } = ctx;

    // Network must be founded
    if (!isNetworkFounded(state)) {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Cannot revise group: network not founded");
    }

    // Group must exist
    const group = getGroup(state, payload.groupId as GroupId);
    if (!group) {
      throw new DomainError("NOT_FOUND", `Group not found: ${payload.groupId}`, { groupId: payload.groupId });
    }

    // Group must be active
    if (group.status !== "active") {
      throw new DomainError("VALIDATION_ERROR", `Cannot revise dissolved group: ${payload.groupId}`, {
        groupId: payload.groupId,
        status: group.status,
      });
    }

    // Only owner, admin, or group leader can revise
    const isLeader = group.members.some((m) => m.accountId === principal.accountId && m.role === "leader");
    if (!principal.roles.includes("owner") && !principal.roles.includes("admin") && !isLeader) {
      throw new DomainError("FORBIDDEN", "Only owner, admin, or group leader can revise groups");
    }

    // Must have at least one change
    const hasChanges =
      payload.changes.name !== undefined || payload.changes.description !== undefined || payload.changes.permissions !== undefined;

    if (!hasChanges) {
      throw new DomainError("VALIDATION_ERROR", "No changes specified for group revision");
    }
  },

  apply(payload: ReviseGroupPayload, ctx: CommandContext): CommandResult {
    const { state, principal, now } = ctx;
    const groupId = payload.groupId as GroupId;
    const existingGroup = getGroup(state, groupId)!;

    const updatedGroup: Group = {
      ...existingGroup,
      name: payload.changes.name ?? existingGroup.name,
      description: payload.changes.description ?? existingGroup.description,
      permissions: payload.changes.permissions ?? existingGroup.permissions,
      updatedAt: now,
    };

    const newGroups = new Map(state.groups);
    newGroups.set(groupId, updatedGroup);

    const newState = {
      ...state,
      groups: newGroups,
      seq: state.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "GroupRevised",
          payload: {
            groupId: payload.groupId,
            changes: payload.changes as Record<string, unknown>,
            revisedBy: principal.accountId,
            revisedAt: now,
          },
        },
      ],
      newState,
    };
  },
};

// ============================================================
// dissolveGroup Handler
// ============================================================

export const dissolveGroupHandler: CommandHandler<"dissolveGroup"> = {
  name: "dissolveGroup",

  validate(payload: DissolveGroupPayload, ctx: CommandContext): void {
    const { state, principal } = ctx;

    // Network must be founded
    if (!isNetworkFounded(state)) {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Cannot dissolve group: network not founded");
    }

    // Group must exist
    const group = getGroup(state, payload.groupId as GroupId);
    if (!group) {
      throw new DomainError("NOT_FOUND", `Group not found: ${payload.groupId}`, { groupId: payload.groupId });
    }

    // Group must be active
    if (group.status !== "active") {
      throw new DomainError("VALIDATION_ERROR", `Group already dissolved: ${payload.groupId}`, {
        groupId: payload.groupId,
        status: group.status,
      });
    }

    // Only owner or admin can dissolve groups
    if (!principal.roles.includes("owner") && !principal.roles.includes("admin")) {
      throw new DomainError("FORBIDDEN", "Only owner or admin can dissolve groups");
    }

    // Reason is required
    if (!payload.reason || payload.reason.trim() === "") {
      throw new DomainError("VALIDATION_ERROR", "Reason is required for dissolving a group");
    }
  },

  apply(payload: DissolveGroupPayload, ctx: CommandContext): CommandResult {
    const { state, principal, now } = ctx;
    const groupId = payload.groupId as GroupId;
    const existingGroup = getGroup(state, groupId)!;

    const dissolvedGroup: Group = {
      ...existingGroup,
      status: "dissolved",
      updatedAt: now,
    };

    const newGroups = new Map(state.groups);
    newGroups.set(groupId, dissolvedGroup);

    const newState = {
      ...state,
      groups: newGroups,
      seq: state.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "GroupDissolved",
          payload: {
            groupId: payload.groupId,
            dissolvedBy: principal.accountId,
            reason: payload.reason,
            dissolvedAt: now,
          },
        },
      ],
      newState,
    };
  },
};

// ============================================================
// assignMember Handler
// ============================================================

export const assignMemberHandler: CommandHandler<"assignMember"> = {
  name: "assignMember",

  validate(payload: AssignMemberPayload, ctx: CommandContext): void {
    const { state, principal } = ctx;

    // Network must be founded
    if (!isNetworkFounded(state)) {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Cannot assign member: network not founded");
    }

    // Group must exist
    const group = getGroup(state, payload.groupId as GroupId);
    if (!group) {
      throw new DomainError("NOT_FOUND", `Group not found: ${payload.groupId}`, { groupId: payload.groupId });
    }

    // Group must be active
    if (group.status !== "active") {
      throw new DomainError("VALIDATION_ERROR", `Cannot modify dissolved group: ${payload.groupId}`, {
        groupId: payload.groupId,
        status: group.status,
      });
    }

    // Only owner, admin, or group leader can assign members
    const isLeader = group.members.some((m) => m.accountId === principal.accountId && m.role === "leader");
    if (!principal.roles.includes("owner") && !principal.roles.includes("admin") && !isLeader) {
      throw new DomainError("FORBIDDEN", "Only owner, admin, or group leader can assign members");
    }

    // Account must exist
    if (!hasAccount(state, payload.accountId as AccountId)) {
      throw new DomainError("NOT_FOUND", `Account not found: ${payload.accountId}`, { accountId: payload.accountId });
    }

    const existingMember = group.members.find((m) => m.accountId === payload.accountId);

    switch (payload.action) {
      case "add":
        if (existingMember) {
          throw new DomainError("ALREADY_EXISTS", `Account is already a member of this group`, {
            accountId: payload.accountId,
            groupId: payload.groupId,
          });
        }
        break;
      case "remove":
        if (!existingMember) {
          throw new DomainError("NOT_FOUND", `Account is not a member of this group`, {
            accountId: payload.accountId,
            groupId: payload.groupId,
          });
        }
        // Cannot remove the last leader
        if (existingMember.role === "leader") {
          const leaderCount = group.members.filter((m) => m.role === "leader").length;
          if (leaderCount <= 1) {
            throw new DomainError("VALIDATION_ERROR", "Cannot remove the last leader from the group");
          }
        }
        break;
      case "update":
        if (!existingMember) {
          throw new DomainError("NOT_FOUND", `Account is not a member of this group`, {
            accountId: payload.accountId,
            groupId: payload.groupId,
          });
        }
        // Cannot demote the last leader
        if (existingMember.role === "leader" && payload.role === "member") {
          const leaderCount = group.members.filter((m) => m.role === "leader").length;
          if (leaderCount <= 1) {
            throw new DomainError("VALIDATION_ERROR", "Cannot demote the last leader");
          }
        }
        break;
    }
  },

  apply(payload: AssignMemberPayload, ctx: CommandContext): CommandResult {
    const { state, principal, now } = ctx;
    const groupId = payload.groupId as GroupId;
    const accountId = payload.accountId as AccountId;
    const existingGroup = getGroup(state, groupId)!;

    let updatedMembers: GroupMember[];

    switch (payload.action) {
      case "add":
        updatedMembers = [
          ...existingGroup.members,
          {
            accountId,
            role: payload.role as GroupMemberRole,
            joinedAt: now,
          },
        ];
        break;
      case "remove":
        updatedMembers = existingGroup.members.filter((m) => m.accountId !== accountId);
        break;
      case "update":
        updatedMembers = existingGroup.members.map((m) =>
          m.accountId === accountId ? { ...m, role: payload.role as GroupMemberRole } : m,
        );
        break;
    }

    const updatedGroup: Group = {
      ...existingGroup,
      members: updatedMembers,
      updatedAt: now,
    };

    const newGroups = new Map(state.groups);
    newGroups.set(groupId, updatedGroup);

    const newState = {
      ...state,
      groups: newGroups,
      seq: state.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "MemberAssigned",
          payload: {
            groupId: payload.groupId,
            accountId: payload.accountId,
            role: payload.role,
            action: payload.action,
            assignedBy: principal.accountId,
            assignedAt: now,
          },
        },
      ],
      newState,
    };
  },
};
