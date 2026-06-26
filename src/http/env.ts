/**
 * Hono environment type definitions
 */

import type { Principal, NetworkState, Account } from "../domain/models/types.js";
import type { CommandBus } from "../application/commandBus.js";

export interface Variables {
  requestId: string;
  account: Account | null;
  principal: Principal;
  state: NetworkState;
  commandBus: CommandBus;
}

export interface Bindings {
  // Future: environment bindings
}

export interface Env {
  Variables: Variables;
  Bindings: Bindings;
}
