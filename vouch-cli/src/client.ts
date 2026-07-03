// VouchClient — the reusable, non-custodial client SDK.
//
// This is the shared substrate the meeting's "1 API, many thin clients" plan calls
// for: the CLI is a thin shell over it, and a Web GUI could import the very same
// class. It is NON-CUSTODIAL — the caller holds the Ed25519 key; the SDK signs
// locally (registerBytes/commandBytes, the same domain-separated bytes the node
// verifies) and speaks the node's HTTP API. It never sees a private key it did not
// receive, and it stores no nonce state: the node's `/v1/account` is the single
// source of truth, so a fresh client is always in step.

import { ED25519_SUITE, encodeBase64, type KeyPair } from "vouch-core";
import { commandBytes, registerBytes } from "vouch-node";

export interface AccountState {
  readonly principal: string;
  readonly registered: boolean;
  /** Last nonce the node recorded, or -1 if unregistered. The next signed command uses nonce+1. */
  readonly nonce: number;
}

export type SubmitResult =
  | { readonly ok: true; readonly detail: Record<string, unknown>; readonly events: number }
  | { readonly ok: false; readonly status: number; readonly reason: string };

export type RegisterResult = { readonly ok: true } | { readonly ok: false; readonly status: number; readonly reason: string };

/** A world event as returned by the node's observation log. */
export interface LogEvent {
  readonly seq: number;
  readonly type: string;
  readonly actor: string;
  readonly payload: unknown;
}

export class VouchClient {
  constructor(
    private readonly nodeUrl: string,
    /** The signing key. Optional: reads work without one; register/submit throw if it is absent. */
    private readonly keyPair?: KeyPair,
    /** Per-request timeout so a dead/slow node fails fast instead of hanging. */
    private readonly timeoutMs = 10_000,
  ) {}

  private requireKey(): KeyPair {
    if (!this.keyPair) throw new Error("this operation needs a key — run: vouch keygen");
    return this.keyPair;
  }

  /** The base64 Ed25519 public key this client signs with. */
  get publicKey(): string {
    return encodeBase64(this.requireKey().publicKey);
  }

  /** fetch with a timeout, normalizing transport failures (timeout / connection refused) to a clear message. */
  private async fetchWithTimeout(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.nodeUrl}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`request to ${this.nodeUrl}${path} timed out after ${this.timeoutMs}ms — is the node running?`);
      }
      throw new Error(`request to ${this.nodeUrl}${path} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchWithTimeout(path);
    if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }

  private async postJson(
    path: string,
    body: unknown,
  ): Promise<{ ok: boolean; status: number; body: { detail?: Record<string, unknown>; events?: number; error?: { code: string } } }> {
    const res = await this.fetchWithTimeout(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as never };
  }

  /** A principal's account state on the node (registration + current nonce). */
  account(principal: string): Promise<AccountState> {
    return this.getJson<AccountState>(`/v1/account/${encodeURIComponent(principal)}`);
  }

  /** Bind this key to a principal via a self-signed registration (first-writer-wins on the node). */
  async register(principal: string): Promise<RegisterResult> {
    const kp = this.requireKey();
    const publicKey = encodeBase64(kp.publicKey);
    const signature = encodeBase64(ED25519_SUITE.sign(registerBytes(principal, 0, publicKey), kp.privateKey));
    const { ok, status, body } = await this.postJson("/v1/register", { principal, publicKey, nonce: 0, signature });
    return ok ? { ok: true } : { ok: false, status, reason: body.error?.code ?? `http-${status}` };
  }

  /**
   * Sign and submit a command AS `principal`. Reads the current nonce from the node,
   * signs with nonce+1, and — because a rejected command still consumes a nonce and a
   * concurrent client may have moved the counter — retries once on a stale nonce.
   */
  async submit(principal: string, command: unknown): Promise<SubmitResult> {
    const kp = this.requireKey();
    const first = await this.account(principal);
    if (!first.registered) throw new Error(`principal "${principal}" is not registered — run: vouch register ${principal}`);

    for (let attempt = 0; attempt < 3; attempt++) {
      const nonce = (await this.account(principal)).nonce + 1;
      const signature = encodeBase64(ED25519_SUITE.sign(commandBytes(principal, nonce, command), kp.privateKey));
      const { ok, status, body } = await this.postJson("/v1/command", { principal, nonce, command, signature });
      if (ok) return { ok: true, detail: body.detail ?? {}, events: body.events ?? 0 };
      const reason = body.error?.code ?? `http-${status}`;
      if (reason === "stale-nonce" && attempt < 2) continue; // re-read the counter and retry
      return { ok: false, status, reason };
    }
    return { ok: false, status: 409, reason: "nonce-contention" };
  }

  // --- command conveniences ---------------------------------------------------
  found(principal: string, regionId: string, displayName: string): Promise<SubmitResult> {
    return this.submit(principal, { kind: "found", regionId, displayName });
  }
  admit(principal: string, agentId: string, region: string, role: string, currency?: number): Promise<SubmitResult> {
    return this.submit(principal, { kind: "admit", agentId, region, role, ...(currency !== undefined ? { currency } : {}) });
  }
  transfer(principal: string, to: string, amount: number): Promise<SubmitResult> {
    return this.submit(principal, { kind: "transfer", from: principal, to, amount });
  }
  vouch(principal: string, to: string, weight: number): Promise<SubmitResult> {
    return this.submit(principal, { kind: "vouch", from: principal, to, weight });
  }

  // --- reads (observation surface) --------------------------------------------
  regions(): Promise<unknown[]> {
    return this.getJson("/regions");
  }
  agents(): Promise<unknown[]> {
    return this.getJson("/agents");
  }
  state(): Promise<unknown> {
    return this.getJson("/state");
  }
  metrics(): Promise<unknown> {
    return this.getJson("/metrics");
  }
  /** Events with seq beyond `since` — the feed `watch` tails. */
  log(since = 0): Promise<LogEvent[]> {
    return this.getJson<LogEvent[]>(`/log?since=${since}`);
  }
}
