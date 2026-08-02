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
import type { AccountLog } from "./account-log";
import { AccountRegistry, type AuthResult, type HttpStatus, type RegisterRequest, type SignedRequest } from "./accounts";
import { type Command, commandSchema, dispatch } from "./commands";
import type { Journal } from "./journal";
import { type Logger, silentLogger } from "./log";

export interface NodeDeps {
  readonly seed: string;
  readonly notary: KeyPair;
  readonly journal: Journal;
  readonly accountLog: AccountLog;
  /**
   * Called when a DURABLE APPEND fails (ENOSPC, EIO, a read-only data dir, …).
   * The default kills the process, and that is deliberate: state advances in memory
   * at dispatch and is persisted afterwards, so a node that keeps serving after a
   * failed append is serving a world its journal never saw — the change vanishes on
   * restart and every later write chains onto phantom state. Dying instead lets the
   * supervisor restart us, and boot replay puts us back on the durable truth.
   * Injectable so tests can assert the path without exiting the test runner.
   */
  readonly onDurabilityFailure?: (err: unknown) => void;
  /** Structured logger. Defaults to silent so embedders/tests stay quiet. */
  readonly log?: Logger;
}

export type SubmitResult =
  | { readonly ok: true; readonly status: 200; readonly detail?: Record<string, unknown>; readonly events: number }
  | {
      readonly ok: false;
      readonly status: HttpStatus;
      readonly reason: string;
      /**
       * Whether the signature verified before this failed.
       *
       * Reported rather than inferred from the status because it decides who PAYS for
       * the request: an authenticated write consumed a nonce and did durable work even
       * when the engine then refused it, while an unauthenticated one must never cost
       * the principal it merely claimed to be. Inferring that from status codes would
       * quietly make the next post-auth failure free.
       */
      readonly authenticated: boolean;
    };

export class VouchNode {
  /** Read-only observation reads this; the write path uses the engine's emit. */
  readonly world: World<WorldState>;
  private readonly registry: AccountRegistry;
  private readonly journal: Journal;
  private readonly notary: KeyPair;
  private readonly onDurabilityFailure: (err: unknown) => void;
  private readonly log: Logger;

  constructor(deps: NodeDeps) {
    this.journal = deps.journal;
    this.notary = deps.notary;
    this.world = rehydrateAlmaWorld(deps.seed, deps.journal.load());
    this.registry = new AccountRegistry(deps.accountLog);
    this.log = deps.log ?? silentLogger;
    this.onDurabilityFailure =
      deps.onDurabilityFailure ??
      ((err) => {
        this.log.fatal({ err }, "durable append failed — exiting rather than serving un-persisted state");
        process.exit(1);
      });
  }

  /**
   * Run a step that persists. A throw here is a durability failure — the auth log or
   * the journal did not take the write — so we hand it to `onDurabilityFailure`
   * (which normally exits) instead of returning an error and continuing to serve.
   */
  private durable<T>(step: () => T): T {
    try {
      return step();
    } catch (err) {
      this.onDurabilityFailure(err);
      throw err; // if the handler returned (tests), don't pretend the write succeeded
    }
  }

  /** Bind a principal to a public key (self-signed; first-writer-wins). */
  register(req: RegisterRequest): AuthResult {
    return this.durable(() => this.registry.register(req));
  }

  /** Whether a principal has been bound to a key. */
  isRegistered(principal: string): boolean {
    return this.registry.has(principal);
  }

  /**
   * The last nonce recorded for a principal, or null if unregistered. A custodial
   * signer seeds its per-principal counter from this so its next signed command
   * carries a strictly-increasing nonce even across a signer restart.
   */
  nonceOf(principal: string): number | null {
    return this.registry.nonceOf(principal);
  }

  /** Verify + apply a signed command, persisting whatever events it emits. */
  submit(req: SignedRequest): SubmitResult {
    // Parse first, so a malformed command doesn't consume the principal's nonce.
    const parsed = commandSchema.safeParse(req.command);
    if (!parsed.success) return { ok: false, status: 400, reason: "invalid-command", authenticated: false };

    // verify() persists the consumed nonce before we dispatch, so it is a durable step.
    const auth = this.durable(() => this.registry.verify(req));
    if (!auth.ok) return { ok: false, status: auth.status, reason: auth.reason, authenticated: false };

    const before = this.world.log.length;
    const outcome = dispatch(this.world, auth.principal, parsed.data, { notary: this.notary });

    // Persist whatever the command emitted, regardless of outcome, so the durable
    // journal can never diverge from the live world on the next boot. (Today every
    // command validates fully before emitting, so a rejection emits nothing and this
    // is a no-op on the failure path; the guarantee holds for future commands too.)
    const emitted = this.world.log.length - before;
    this.durable(() => this.journal.append(this.world.log.since(before)));

    // Authenticated: the nonce was consumed and the durable append happened, whatever
    // the engine then decided about the command itself.
    if (!outcome.ok) return { ok: false, status: 422, reason: outcome.reason, authenticated: true };
    return { ok: true, status: 200, detail: outcome.detail, events: emitted };
  }
}

export type { Command };
