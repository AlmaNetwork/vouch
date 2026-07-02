/**
 * Amend command handler
 * Modifies network settings (owner only)
 */

import { accountNotFound, forbidden, networkNotFounded } from "../../domain/models/errors.js";
import type { AccountId, NetworkState } from "../../domain/models/types.js";
import { ownerPolicy } from "../../domain/policies/index.js";
import type { NetworkAmendedEvent } from "../../domain/projector.js";
import type { AmendCommand } from "../commandPacket.js";

export function handleAmend(state: NetworkState, command: AmendCommand): NetworkAmendedEvent[] {
  // Validate: network must exist
  if (state.regionId === "") {
    throw networkNotFounded();
  }

  // Validate: only owner can amend
  if (!ownerPolicy.canAmend(state, command.principal)) {
    throw forbidden("Only owner can amend network settings");
  }

  const { changes } = command.payload;

  // Validate: if changing owner, new owner must exist
  if (changes.ownerId) {
    const typedOwnerId = changes.ownerId as AccountId;
    if (!state.accounts.has(typedOwnerId)) {
      throw accountNotFound(changes.ownerId);
    }
  }

  const event: NetworkAmendedEvent = {
    type: "NetworkAmended",
    changes,
    timestamp: command.meta.receivedAt,
  };

  return [event];
}
