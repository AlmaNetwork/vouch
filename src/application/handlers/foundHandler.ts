/**
 * Found command handler
 * Creates a new network with an owner
 */

import type { FoundCommand } from "../commandPacket.js";
import type { NetworkState } from "../../domain/models/types.js";
import { networkAlreadyFounded } from "../../domain/models/errors.js";
import type { NetworkFoundedEvent } from "../../domain/projector.js";

export function handleFound(
  state: NetworkState,
  command: FoundCommand
): NetworkFoundedEvent[] {
  // Validate: network must not already exist
  if (state.regionId !== "") {
    throw networkAlreadyFounded();
  }

  const event: NetworkFoundedEvent = {
    type: "NetworkFounded",
    regionId: command.payload.regionId,
    ownerId: command.principal.accountId,
    ownerEmail: command.payload.ownerEmail,
    timestamp: command.meta.receivedAt,
  };

  return [event];
}
