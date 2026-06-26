// Typed client for the read-only observation API.
//
// Types come from `schema.d.ts`, GENERATED from openapi/read.yaml (`bun run gen:api`),
// so the client can't drift from the contract. Read-only — mirrors the GET-only server.

import type { components } from "./schema";

type Schemas = components["schemas"];
export type Metrics = Schemas["Metrics"];
export type RegionState = Schemas["RegionState"];
export type AgentState = Schemas["AgentState"];
export type AlmaEvent = Schemas["AlmaEvent"];

export interface Health {
  ok: boolean;
  tick: number;
}

/** A read-only client for a vouch observation server. */
export class ObservationClient {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  health = () => this.get<Health>("/health");
  metrics = () => this.get<Metrics>("/metrics");
  regions = () => this.get<RegionState[]>("/regions");
  agents = () => this.get<AgentState[]>("/agents");
  log = (since = 0) => this.get<AlmaEvent[]>(`/log?since=${since}`);
  logDigest = () => this.get<{ digest: string; length: number }>("/log/digest");
}
