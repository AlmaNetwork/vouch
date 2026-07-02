// The participate node — a durable, authenticated write path onto the engine.
//
// On boot it REPLAYS its journal into a live world (rehydrateAlmaWorld), so state
// survives restarts. A command is: parse -> verify signature -> apply via the
// engine -> persist the emitted events. Reads go through the engine's read-only
// observation surface (see http.ts); the node never mutates state except through
// the engine's emit path, so conservation and replay hold end to end.

import type { KeyPair } from "vouch-core";
import { rehydrateAlmaWorld, type WorldState } from "vouch-world/environment";
import type { World } from "vouch-world/foundation";
import { type AccountLog, AccountRegistry, type AuthResult, type HttpStatus, type RegisterRequest, type SignedRequest } from "./accounts";
import { type Command, commandSchema, dispatch } from "./commands";
import type { Journal } from "./journal";

export interface NodeDeps {
  readonly seed: string;
  readonly notary: KeyPair;
  readonly journal: Journal;
  readonly accountLog: AccountLog;
}

export type SubmitResult =
  | { readonly ok: true; readonly status: 200; readonly detail?: Record<string, unknown>; readonly events: number }
  | { readonly ok: false; readonly status: HttpStatus; readonly reason: string };

export class VouchNode {
  /** Read-only observation reads this; the write path uses the engine's emit. */
  readonly world: World<WorldState>;
  private readonly registry: AccountRegistry;
  private readonly journal: Journal;
  private readonly notary: KeyPair;

  constructor(deps: NodeDeps) {
    this.journal = deps.journal;
    this.notary = deps.notary;
    this.world = rehydrateAlmaWorld(deps.seed, deps.journal.load());
    this.registry = new AccountRegistry(deps.accountLog);
  }

  /** Bind a principal to a public key (self-signed; first-writer-wins). */
  register(req: RegisterRequest): AuthResult {
    return this.registry.register(req);
  }

  /** Verify + apply a signed command, persisting whatever events it emits. */
  submit(req: SignedRequest): SubmitResult {
    // Parse first, so a malformed command doesn't consume the principal's nonce.
    const parsed = commandSchema.safeParse(req.command);
    if (!parsed.success) return { ok: false, status: 400, reason: "invalid-command" };

    const auth = this.registry.verify(req);
    if (!auth.ok) return { ok: false, status: auth.status, reason: auth.reason };

    const before = this.world.log.length;
    const outcome = dispatch(this.world, auth.principal, parsed.data, { notary: this.notary });

    // Persist whatever the command emitted, regardless of outcome, so the durable
    // journal can never diverge from the live world on the next boot. (Today every
    // command validates fully before emitting, so a rejection emits nothing and this
    // is a no-op on the failure path; the guarantee holds for future commands too.)
    const emitted = this.world.log.length - before;
    this.journal.append(this.world.log.since(before));

    if (!outcome.ok) return { ok: false, status: 422, reason: outcome.reason };
    return { ok: true, status: 200, detail: outcome.detail, events: emitted };
  }
}

export type { Command };
