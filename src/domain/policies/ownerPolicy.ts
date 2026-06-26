/**
 * Owner authorization policy
 * Determines if a principal can perform owner-level operations
 */

import type { NetworkState, Principal, ResidentId } from "../models/types.js";

/**
 * Check if principal is the network owner
 */
export function isOwner(state: NetworkState, principal: Principal): boolean {
  return state.ownerId === principal.accountId;
}

/**
 * Check if principal has admin role
 */
export function isAdmin(principal: Principal): boolean {
  return principal.roles.includes("admin") || principal.roles.includes("system");
}

/**
 * Check if principal can perform owner-only operations
 */
export function canPerformOwnerOperation(
  state: NetworkState,
  principal: Principal
): boolean {
  return isOwner(state, principal) || isAdmin(principal);
}

/**
 * Check if principal can amend a specific resource
 * For now, only owners can amend
 */
export function canAmend(
  state: NetworkState,
  principal: Principal,
  _targetId?: string
): boolean {
  return canPerformOwnerOperation(state, principal);
}

/**
 * Check if principal can admit new residents
 * Only owners can admit
 */
export function canAdmit(
  state: NetworkState,
  principal: Principal
): boolean {
  return canPerformOwnerOperation(state, principal);
}

/**
 * Check if principal can transact on behalf of a resident
 */
export function canTransact(
  state: NetworkState,
  principal: Principal,
  fromResidentId: ResidentId
): boolean {
  const resident = state.residents.get(fromResidentId);
  if (!resident) return false;

  // Can transact if you own the resident account or are admin/owner
  return (
    resident.accountId === principal.accountId ||
    canPerformOwnerOperation(state, principal)
  );
}

/**
 * Check if principal can migrate the network schema
 * Only owners/admins can migrate
 */
export function canMigrate(
  state: NetworkState,
  principal: Principal
): boolean {
  return canPerformOwnerOperation(state, principal);
}
