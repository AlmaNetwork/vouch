// The durable auth log — the account registry's persistence, mirroring journal.ts
// over the same persist.ts primitives. Append-only: a `register` line binds a
// principal to a key; a `nonce` line advances its replay counter. Replayed on boot
// by AccountRegistry (see accounts.ts).
//
// Tamper-evidence: hash-chained exactly like the event journal, and for a sharper
// reason. This file holds every principal's nonce, and the nonce is the ONLY thing
// standing between a captured request and a replay of it. Rewind a nonce and an old
// signed command becomes valid again — the signature was always valid, the counter is
// what refused it. The journal being chained while this was not left the cheaper file
// to attack guarding the more dangerous state.
//
// It also catches the accident. Restoring a journal against a stale auth log rewinds
// nonces without anyone touching anything maliciously; before, nothing noticed.

import { createHash } from "node:crypto";
import { canonicalBytes } from "vouch-core";
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

/** In-memory auth log (tests, ephemeral nodes) — no on-disk surface, so no chain. */
export class MemoryAccountLog implements AccountLog {
  private readonly lines: AuthLine[] = [];
  append(line: AuthLine): void {
    this.lines.push(line);
  }
  load(): AuthLine[] {
    return [...this.lines];
  }
}

/** A persisted line: the auth record plus its chain hash. */
type ChainedLine = { readonly line: AuthLine; readonly hash: string };

/** Minimal structural check that a decoded value is an AuthLine (not injected garbage). */
function isAuthLine(v: unknown): v is AuthLine {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  if (typeof l.principal !== "string" || typeof l.nonce !== "number") return false;
  if (l.kind === "nonce") return true;
  return l.kind === "register" && typeof l.publicKey === "string";
}

/** Decode a line strictly as `{ line, hash }` — exactly those keys, line a real AuthLine. */
function asChainedLine(v: unknown): ChainedLine | null {
  if (typeof v !== "object" || v === null) return null;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes("line") || !keys.includes("hash")) return null;
  const { line, hash } = v as { line: unknown; hash: unknown };
  if (typeof hash !== "string" || !isAuthLine(line)) return null;
  return { line, hash };
}

/**
 * The chain link: sha256 (hex) over the canonical bytes of `{ prev, line }`.
 *
 * The field is named `line` where the journal's is `event`, which domain-separates the
 * two chains: a record lifted from one file cannot verify in the other, even at the
 * same position, because the bytes being hashed differ.
 */
function linkHash(prev: string, line: AuthLine): string {
  return createHash("sha256").update(canonicalBytes({ prev, line })).digest("hex");
}

/** File-backed JSON Lines auth log — strictly hash-chained, appended durably (fsync). */
export class FileAccountLog implements AccountLog {
  private tip: string | null = null; // chain hash of the last persisted line ("" = empty)

  constructor(private readonly path: string) {}

  append(line: AuthLine): void {
    const prev = this.tip ?? this.foldChain().tip;
    const hash = linkHash(prev, line);
    durableAppend(this.path, `${JSON.stringify({ line, hash } satisfies ChainedLine)}\n`);
    this.tip = hash;
  }

  load(): AuthLine[] {
    const { lines, tip } = this.foldChain();
    this.tip = tip;
    return lines;
  }

  /** Re-fold + verify the whole chain from genesis; returns the lines and the chain tip. */
  private foldChain(): { lines: AuthLine[]; tip: string } {
    const raw = loadJsonl<unknown>(this.path);
    let prev = "";
    const lines: AuthLine[] = [];
    for (const [i, entry] of raw.entries()) {
      const cl = asChainedLine(entry);
      if (!cl) {
        throw new Error(`auth log: malformed or un-chained line at ${i + 1} — the log is corrupt or has been tampered with`);
      }
      if (cl.hash !== linkHash(prev, cl.line)) {
        throw new Error(`auth log: hash-chain broken at line ${i + 1} — the log has been tampered with or reordered`);
      }
      prev = cl.hash;
      lines.push(cl.line);
    }
    return { lines, tip: prev };
  }
}
