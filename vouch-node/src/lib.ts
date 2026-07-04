// Public library surface for the participate node.
//
// This barrel is SIDE-EFFECT FREE — importing it never binds a socket. It is the
// package's `.` export, so other packages (e.g. vouch-mcp) get the node's building
// blocks without pulling in index.ts, which is the runnable entrypoint that calls
// Bun.serve(). Keep server boot in index.ts; keep reusable pieces reachable here.

export type { AccountLog, AuthLine } from "./account-log";
export { FileAccountLog, MemoryAccountLog } from "./account-log";
export {
  AccountRegistry,
  type AuthResult,
  commandBytes,
  type HttpStatus,
  type RegisterRequest,
  registerBytes,
  type SignedRequest,
} from "./accounts";
export { type Command, type CommandResult, commandSchema, dispatch } from "./commands";
export { loadConfig, type NodeConfig, type RawEnv, resolveNotary } from "./config";
export { createNodeApp } from "./http";
export { FileJournal, type Journal, MemoryJournal } from "./journal";
export { type NodeDeps, type SubmitResult, VouchNode } from "./node";
