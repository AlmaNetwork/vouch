/**
 * Commands Module Index
 *
 * Exports the command registry and all handlers.
 */

export * from "./handlers/index.js";
export * from "./registry.js";

import {
  abolishLawHandler,
  acceptInviteHandler,
  admitHandler,
  amendHandler,
  assignMemberHandler,
  defineAssetTypeHandler,
  disposeAssetHandler,
  dissolveGroupHandler,
  establishHandler,
  inviteHandler,
  issueAssetHandler,
  makeGroupHandler,
  makeLawHandler,
  reinstateHandler,
  reviseGroupHandler,
  reviseLawHandler,
  revokeAssetHandler,
  suspendHandler,
  transactHandler,
  transferAssetHandler,
} from "./handlers/index.js";
import { commandRegistry } from "./registry.js";

/**
 * Initialize the command registry with all handlers.
 * Call this once at application startup.
 */
export function initializeCommandRegistry(): void {
  commandRegistry.register(establishHandler);
  commandRegistry.register(admitHandler);
  commandRegistry.register(amendHandler);
  commandRegistry.register(transactHandler);
  // Asset commands
  commandRegistry.register(defineAssetTypeHandler);
  commandRegistry.register(issueAssetHandler);
  commandRegistry.register(transferAssetHandler);
  commandRegistry.register(disposeAssetHandler);
  commandRegistry.register(revokeAssetHandler);
  // Law commands
  commandRegistry.register(makeLawHandler);
  commandRegistry.register(reviseLawHandler);
  commandRegistry.register(abolishLawHandler);
  // Membership commands
  commandRegistry.register(inviteHandler);
  commandRegistry.register(acceptInviteHandler);
  commandRegistry.register(suspendHandler);
  commandRegistry.register(reinstateHandler);
  // Organization commands
  commandRegistry.register(makeGroupHandler);
  commandRegistry.register(reviseGroupHandler);
  commandRegistry.register(dissolveGroupHandler);
  commandRegistry.register(assignMemberHandler);
}
