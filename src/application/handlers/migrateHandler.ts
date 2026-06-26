/**
 * Migrate command handler
 * Handles schema version migrations
 */

import type { MigrateCommand } from "../commandPacket.js";
import { CURRENT_SCHEMA_VERSION } from "../commandPacket.js";
import type { NetworkState } from "../../domain/models/types.js";
import {
  networkNotFounded,
  forbidden,
  DomainError,
} from "../../domain/models/errors.js";
import { ownerPolicy } from "../../domain/policies/index.js";
import type { SchemaMigratedEvent } from "../../domain/projector.js";

export function handleMigrate(
  state: NetworkState,
  command: MigrateCommand
): SchemaMigratedEvent[] {
  // Validate: network must exist
  if (state.regionId === "") {
    throw networkNotFounded();
  }

  // Validate: only owner can migrate
  if (!ownerPolicy.canMigrate(state, command.principal)) {
    throw forbidden("Only owner can migrate schema");
  }

  const { targetVersion } = command.payload;

  // Validate: target version must be valid
  if (targetVersion < 1 || targetVersion > CURRENT_SCHEMA_VERSION) {
    throw new DomainError(
      "SCHEMA_VERSION_MISMATCH",
      `Invalid target version: ${targetVersion}. Current version is ${CURRENT_SCHEMA_VERSION}`
    );
  }

  // For now, migrations are no-ops as we're at version 1
  // Future migrations would apply transformations here

  const event: SchemaMigratedEvent = {
    type: "SchemaMigrated",
    fromVersion: command.schemaVersion,
    toVersion: targetVersion,
    timestamp: command.meta.receivedAt,
  };

  return [event];
}
