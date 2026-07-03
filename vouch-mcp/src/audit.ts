// Append-only sign audit — the accountability substrate for custodial signing.
//
// A custodial signature proves the SERVER signed, not that the human personally
// acted; this log is what lets a signed command be attributed back to the OAuth
// token that caused it. Every signing attempt is recorded (accepted OR rejected),
// with the token's subject/jti, the granted scopes, the command kind, and a HASH
// of the command bytes. It deliberately stores NO secret: never the access token,
// never the derived seed, never the private key.

import { createHash } from "node:crypto";

export interface SignAuditEntry {
  readonly requestId: string;
  readonly ts: number; // wall-clock ms (infra, not domain time)
  readonly iss: string;
  readonly sub: string;
  readonly principal: string;
  readonly nonce: number;
  readonly scope: readonly string[];
  readonly jti: string | null;
  readonly commandKind: string;
  readonly commandHash: string; // sha256 of the canonical command
  readonly outcome: "accepted" | "rejected" | "scope-denied";
  readonly reason: string | null;
}

export interface AuditSink {
  append(entry: SignAuditEntry): void;
  entries(): readonly SignAuditEntry[];
}

/** In-memory audit log (tests, ephemeral nodes). A durable file sink can mirror this later. */
export class MemoryAudit implements AuditSink {
  private readonly log: SignAuditEntry[] = [];
  append(entry: SignAuditEntry): void {
    this.log.push(entry);
  }
  entries(): readonly SignAuditEntry[] {
    return this.log;
  }
}

/** Hash of a command for the audit trail — content-addressed, reveals no secret. */
export function commandHash(command: unknown): string {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}
