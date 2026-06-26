/**
 * Commands Module Index
 *
 * Exports the command registry and all handlers.
 */

export * from "./registry.js";
export * from "./handlers/index.js";

import { commandRegistry } from "./registry.js";
import {
  establishHandler,
  admitHandler,
  amendHandler,
  transactHandler,
  createAssetTypeHandler,
  createAssetHandler,
} from "./handlers/index.js";

/**
 * Initialize the command registry with all handlers.
 * Call this once at application startup.
 */
export function initializeCommandRegistry(): void {
  commandRegistry.register(establishHandler);
  commandRegistry.register(admitHandler);
  commandRegistry.register(amendHandler);
  commandRegistry.register(transactHandler);
  commandRegistry.register(createAssetTypeHandler);
  commandRegistry.register(createAssetHandler);
}
