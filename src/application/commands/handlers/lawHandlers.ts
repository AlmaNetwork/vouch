/**
 * Law Command Handlers
 *
 * Handlers for governance-related commands:
 * - makeLaw: Create a new law
 * - reviseLaw: Modify an existing law
 * - abolishLaw: Abolish an existing law
 */

import { parseLawId } from "../../../domain/models/almaId.js";
import { DomainError } from "../../../domain/models/errors.js";
import type { Law, LawId, LawRule, LawType } from "../../../domain/models/types.js";
import { getLaw, hasLaw, isNetworkFounded } from "../../../domain/models/types.js";
import type { AbolishLawPayload, CommandContext, CommandHandler, CommandResult, MakeLawPayload, ReviseLawPayload } from "../registry.js";

// ============================================================
// makeLaw Handler
// ============================================================

export const makeLawHandler: CommandHandler<"makeLaw"> = {
  name: "makeLaw",

  validate(payload: MakeLawPayload, ctx: CommandContext): void {
    const { state, principal } = ctx;

    // Network must be founded
    if (!isNetworkFounded(state)) {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Cannot create law: network not founded");
    }

    // Only owner or admin can create laws
    if (!principal.roles.includes("owner") && !principal.roles.includes("admin")) {
      throw new DomainError("FORBIDDEN", "Only owner or admin can create laws");
    }

    // Validate law ID format
    const parsed = parseLawId(payload.lawId);
    if (!parsed) {
      throw new DomainError("VALIDATION_ERROR", `Invalid law ID format: ${payload.lawId}`, { lawId: payload.lawId });
    }

    // Law ID must belong to this region
    if (parsed.region.raw !== state.regionId) {
      throw new DomainError("VALIDATION_ERROR", "Law ID must belong to this region", { lawId: payload.lawId, regionId: state.regionId });
    }

    // Law must not already exist
    if (hasLaw(state, payload.lawId as LawId)) {
      throw new DomainError("ALREADY_EXISTS", `Law already exists: ${payload.lawId}`, { lawId: payload.lawId });
    }

    // Validate rule structure
    if (!payload.rule.target) {
      throw new DomainError("VALIDATION_ERROR", "Law rule must specify target command(s)");
    }
  },

  apply(payload: MakeLawPayload, ctx: CommandContext): CommandResult {
    const { state, principal, now } = ctx;
    const lawId = payload.lawId as LawId;

    const rule: LawRule = {
      target: payload.rule.target,
      condition: payload.rule.condition,
      action: payload.rule.action,
      message: payload.rule.message,
    };

    const law: Law = {
      id: lawId,
      regionId: state.regionId,
      name: payload.name,
      description: payload.description || "",
      lawType: payload.lawType as LawType,
      rule,
      createdBy: principal.accountId,
      status: "active",
      effectiveAt: payload.effectiveAt || null,
      createdAt: now,
      updatedAt: now,
    };

    const newLaws = new Map(state.laws);
    newLaws.set(lawId, law);

    const newState = {
      ...state,
      laws: newLaws,
      seq: state.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "LawCreated",
          payload: {
            lawId: payload.lawId,
            regionId: state.regionId,
            createdBy: principal.accountId,
            name: payload.name,
            description: payload.description || "",
            lawType: payload.lawType,
            rule,
            effectiveAt: payload.effectiveAt || null,
            createdAt: now,
          },
        },
      ],
      newState,
    };
  },
};

// ============================================================
// reviseLaw Handler
// ============================================================

export const reviseLawHandler: CommandHandler<"reviseLaw"> = {
  name: "reviseLaw",

  validate(payload: ReviseLawPayload, ctx: CommandContext): void {
    const { state, principal } = ctx;

    // Network must be founded
    if (!isNetworkFounded(state)) {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Cannot revise law: network not founded");
    }

    // Only owner or admin can revise laws
    if (!principal.roles.includes("owner") && !principal.roles.includes("admin")) {
      throw new DomainError("FORBIDDEN", "Only owner or admin can revise laws");
    }

    // Law must exist
    const law = getLaw(state, payload.lawId as LawId);
    if (!law) {
      throw new DomainError("NOT_FOUND", `Law not found: ${payload.lawId}`, { lawId: payload.lawId });
    }

    // Law must be active
    if (law.status !== "active") {
      throw new DomainError("VALIDATION_ERROR", `Cannot revise abolished law: ${payload.lawId}`, {
        lawId: payload.lawId,
        status: law.status,
      });
    }

    // Must have at least one change
    const hasChanges =
      payload.changes.name !== undefined ||
      payload.changes.description !== undefined ||
      payload.changes.rule !== undefined ||
      payload.changes.effectiveAt !== undefined;

    if (!hasChanges) {
      throw new DomainError("VALIDATION_ERROR", "No changes specified for law revision");
    }
  },

  apply(payload: ReviseLawPayload, ctx: CommandContext): CommandResult {
    const { state, principal, now } = ctx;
    const lawId = payload.lawId as LawId;
    const existingLaw = getLaw(state, lawId)!;

    // Merge rule changes if present
    let updatedRule = existingLaw.rule;
    if (payload.changes.rule) {
      updatedRule = {
        ...existingLaw.rule,
        ...payload.changes.rule,
      };
    }

    const updatedLaw: Law = {
      ...existingLaw,
      name: payload.changes.name ?? existingLaw.name,
      description: payload.changes.description ?? existingLaw.description,
      rule: updatedRule,
      effectiveAt: payload.changes.effectiveAt !== undefined ? payload.changes.effectiveAt : existingLaw.effectiveAt,
      updatedAt: now,
    };

    const newLaws = new Map(state.laws);
    newLaws.set(lawId, updatedLaw);

    const newState = {
      ...state,
      laws: newLaws,
      seq: state.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "LawRevised",
          payload: {
            lawId: payload.lawId,
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
// abolishLaw Handler
// ============================================================

export const abolishLawHandler: CommandHandler<"abolishLaw"> = {
  name: "abolishLaw",

  validate(payload: AbolishLawPayload, ctx: CommandContext): void {
    const { state, principal } = ctx;

    // Network must be founded
    if (!isNetworkFounded(state)) {
      throw new DomainError("NETWORK_NOT_FOUNDED", "Cannot abolish law: network not founded");
    }

    // Only owner or admin can abolish laws
    if (!principal.roles.includes("owner") && !principal.roles.includes("admin")) {
      throw new DomainError("FORBIDDEN", "Only owner or admin can abolish laws");
    }

    // Law must exist
    const law = getLaw(state, payload.lawId as LawId);
    if (!law) {
      throw new DomainError("NOT_FOUND", `Law not found: ${payload.lawId}`, { lawId: payload.lawId });
    }

    // Law must be active
    if (law.status !== "active") {
      throw new DomainError("VALIDATION_ERROR", `Law already abolished: ${payload.lawId}`, { lawId: payload.lawId, status: law.status });
    }

    // Reason is required
    if (!payload.reason || payload.reason.trim() === "") {
      throw new DomainError("VALIDATION_ERROR", "Reason is required for abolishing a law");
    }
  },

  apply(payload: AbolishLawPayload, ctx: CommandContext): CommandResult {
    const { state, principal, now } = ctx;
    const lawId = payload.lawId as LawId;
    const existingLaw = getLaw(state, lawId)!;

    const abolishedLaw: Law = {
      ...existingLaw,
      status: "abolished",
      updatedAt: now,
    };

    const newLaws = new Map(state.laws);
    newLaws.set(lawId, abolishedLaw);

    const newState = {
      ...state,
      laws: newLaws,
      seq: state.seq + 1,
      updatedAt: now,
    };

    return {
      events: [
        {
          type: "LawAbolished",
          payload: {
            lawId: payload.lawId,
            abolishedBy: principal.accountId,
            reason: payload.reason,
            abolishedAt: now,
          },
        },
      ],
      newState,
    };
  },
};
