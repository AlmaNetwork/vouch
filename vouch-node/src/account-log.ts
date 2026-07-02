// The durable auth log — the account registry's persistence, mirroring journal.ts
// over the same persist.ts primitives. Append-only: a `register` line binds a
// principal to a key; a `nonce` line advances its replay counter. Replayed on boot
// by AccountRegistry (see accounts.ts).

import { durableAppend, loadJsonl } from "./persist";

/** One line of the append-only auth log. */
export type AuthLine =
  | { readonly kind: "register"; readonly principal: string; readonly publicKey: string; readonly nonce: number }
  | { readonly kind: "nonce"; readonly principal: string; readonly nonce: number };

/** Durable store for the auth log. `load` returns lines in append order. */
export interface AccountLog {
  append(line: AuthLine): void;
  load(): AuthLine[];
}

/** In-memory auth log (tests, ephemeral nodes). */
export class MemoryAccountLog implements AccountLog {
  private readonly lines: AuthLine[] = [];
  append(line: AuthLine): void {
    this.lines.push(line);
  }
  load(): AuthLine[] {
    return [...this.lines];
  }
}

/** File-backed JSON Lines auth log — durable across restarts (fsync). */
export class FileAccountLog implements AccountLog {
  constructor(private readonly path: string) {}
  append(line: AuthLine): void {
    durableAppend(this.path, `${JSON.stringify(line)}\n`);
  }
  load(): AuthLine[] {
    return loadJsonl<AuthLine>(this.path);
  }
}
