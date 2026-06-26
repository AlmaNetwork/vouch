// Typed client for the read-only observation API.
//
// The types come from `schema.d.ts`, which is GENERATED from openapi/read.yaml
// (`bun run gen:api`). Regenerate after the spec changes so the client can never drift
// from the contract. This client is read-only — it mirrors the GET-only server.

import type { components } from "./schema";

type Schemas = components["schemas"];
export type Metrics = Schemas["Metrics"];
export type RegionState = Schemas["RegionState"];
export type AgentState = Schemas["AgentState"];
export type AlmaEvent = Schemas["AlmaEvent"];
export type WorldState = Schemas["WorldState"];

export interface Health {
  ok: boolean;
  tick: number;
}

/** A read-only client for a vouch observation server. */
export class ObservationClient {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    // strip a trailing slash so `${baseUrl}/health` is always well-formed
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`);
    } catch (cause) {
      // Most commonly a CORS/network failure when the node sets no CORS headers.
      throw new Error(
        `request to ${this.baseUrl}${path} failed — the observation server sets no CORS headers, ` +
          "so a browser on another origin needs a dev proxy (see web/vite.config.ts).",
        { cause },
      );
    }
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  health(): Promise<Health> {
    return this.get<Health>("/health");
  }
  tick(): Promise<{ tick: number }> {
    return this.get<{ tick: number }>("/tick");
  }
  metrics(): Promise<Metrics> {
    return this.get<Metrics>("/metrics");
  }
  state(): Promise<WorldState> {
    return this.get<WorldState>("/state");
  }
  regions(): Promise<RegionState[]> {
    return this.get<RegionState[]>("/regions");
  }
  agents(): Promise<AgentState[]> {
    return this.get<AgentState[]>("/agents");
  }
  log(since = 0): Promise<AlmaEvent[]> {
    return this.get<AlmaEvent[]>(`/log?since=${since}`);
  }
  logDigest(): Promise<{ digest: string; length: number }> {
    return this.get<{ digest: string; length: number }>("/log/digest");
  }
}
