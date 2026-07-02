/**
 * Admit command handler
 * Adds a new resident to the network
 */

import { accountAlreadyExists, forbidden, networkNotFounded, residentAlreadyExists } from "../../domain/models/errors.js";
import type { Account, AccountId, NetworkState, Resident, ResidentId } from "../../domain/models/types.js";
import { ownerPolicy } from "../../domain/policies/index.js";
import type { ResidentAdmittedEvent } from "../../domain/projector.js";
import type { AdmitCommand } from "../commandPacket.js";

export function handleAdmit(state: NetworkState, command: AdmitCommand): ResidentAdmittedEvent[] {
  // Validate: network must exist
  if (state.regionId === "") {
    throw networkNotFounded();
  }

  // Validate: only owner can admit
  if (!ownerPolicy.canAdmit(state, command.principal)) {
    throw forbidden("Only owner can admit new residents");
  }

  const { accountId, email, residentId, name, initialStatus } = command.payload;

  // Cast to branded types (validation happens at API layer)
  const typedAccountId = accountId as AccountId;
  const typedResidentId = residentId as ResidentId;

  // Validate: account must not already exist
  if (state.accounts.has(typedAccountId)) {
    throw accountAlreadyExists(accountId);
  }

  // Validate: resident must not already exist
  if (state.residents.has(typedResidentId)) {
    throw residentAlreadyExists(residentId);
  }

  const account: Account = {
    id: typedAccountId,
    email,
    regionId: state.regionId,
    residentId: typedResidentId,
    roles: ["resident"],
    disabled: false,
    createdAt: command.meta.receivedAt,
    updatedAt: command.meta.receivedAt,
  };

  const resident: Resident = {
    id: typedResidentId,
    accountId: typedAccountId,
    regionId: state.regionId,
    name,
    status: initialStatus ?? "active",
    createdAt: command.meta.receivedAt,
    updatedAt: command.meta.receivedAt,
  };

  const event: ResidentAdmittedEvent = {
    type: "ResidentAdmitted",
    resident,
    account,
    timestamp: command.meta.receivedAt,
  };

  return [event];
}
