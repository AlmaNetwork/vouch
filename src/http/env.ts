/**
 * Hono environment type definitions
 */

import type { CommandBus } from "../application/commandBus.js";
import type { Account, NetworkState, Principal } from "../domain/models/types.js";

export interface Variables {
  requestId: string;
  account: Account | null;
  principal: Principal;
  state: NetworkState;
  commandBus: CommandBus;
}

export type Bindings = {};

export interface Env {
  Variables: Variables;
  Bindings: Bindings;
}
