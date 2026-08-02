// Layer 5 Observation — read-only metrics (§2-6). Pure functions over a read-only
// world view; they NEVER write. These are the lenses (§5): economy, trust, diplomacy,
// region lifecycle, mobility, and the log itself.
//
// RFC 0002 (observation of the emergent regime) is measurement-only: this module derives
// dependent variables (per-region breakdown, active/dormant lifecycle, migration /
// secession / ownership-turnover counts, trust activity, reputation) — it exposes NO
// control knobs. Configuring an outcome would defeat the point of observing it.

import { EVENT_AGENT_MIGRATED, EVENT_AGENT_VOUCHED, listAgents } from "../agent";
import type { WorldState } from "../environment";
import { SYSTEM_ACTOR, type WorldView } from "../foundation";
import { EVENT_REGION_OWNERSHIP_TRANSFERRED, listRegions, type RecognitionStatus, type RegionLifecycle } from "../region";

/** Gini coefficient of a list of non-negative values (0 = equal, ~1 = concentrated). */
export function gini(values: readonly number[]): number {
  const v = values
    .filter((x) => x >= 0)
    .slice()
    .sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return 0;
  const sum = v.reduce((s, x) => s + x, 0);
  if (sum === 0) return 0;
  let cumulative = 0;
  for (const [i, x] of v.entries()) cumulative += (i + 1) * x;
  return (2 * cumulative) / (n * sum) - (n + 1) / n;
}

/** Per-region dependent variables (RFC 0002). Residency is derived from the agent slice. */
export interface RegionMetrics {
  readonly id: string;
  readonly status: RecognitionStatus; // recognized | unrecognized (diplomacy)
  readonly lifecycle: RegionLifecycle; // active | dormant (P3)
  readonly residents: number; // agents currently resident (excludes the treasury)
  readonly treasury: number; // the region's treasury currency balance
  readonly currencyGini: number; // Gini over resident currency
}

export interface Metrics {
  tick: number;
  regions: { total: number; recognized: number; unrecognized: number; active: number; dormant: number };
  agents: {
    total: number;
    residents: number;
    treasuries: number;
    totalCurrency: number;
    totalCredit: number;
    currencyGini: number;
    avgReputation: number;
  };
  perRegion: RegionMetrics[];
  mobility: { migrations: number; secessions: number; ownershipTransfers: number };
  trust: { vouches: number };
  log: { length: number; digest: string; eventTypes: Record<string, number> };
}

/** Derive observation metrics from a read-only world view. Reads only. */
export function metrics(view: WorldView<WorldState>): Metrics {
  const state = view.getState();
  const regions = listRegions(state);
  const agents = listAgents(state);
  const residents = agents.filter((a) => a.role !== "treasury");

  // `eventTypes` is the RAW log distribution (forged events included). The behavioral counters
  // below (mobility/trust) count only SYSTEM-authored events: the actor-gate lets forged
  // (non-`"world"`) events sit in the log while the reducers ignore them, so a forged
  // agent.migrated / agent.vouched must not inflate a behavioral RFC 0002 measurement.
  const eventTypes: Record<string, number> = {};
  let migrations = 0;
  let ownershipTransfers = 0;
  let vouches = 0;
  for (const e of view.log.all()) {
    eventTypes[e.type] = (eventTypes[e.type] ?? 0) + 1;
    if (e.actor !== SYSTEM_ACTOR) continue;
    if (e.type === EVENT_AGENT_MIGRATED) migrations += 1;
    else if (e.type === EVENT_REGION_OWNERSHIP_TRANSFERRED) ownershipTransfers += 1;
    else if (e.type === EVENT_AGENT_VOUCHED) vouches += 1;
  }

  // Group the agents by region in ONE pass, rather than scanning every agent once per
  // region. Same numbers; the cost goes from O(regions × agents) to O(regions + agents).
  // The quadratic was the dominant cost of this whole endpoint — 1ms at 100 regions but
  // 154ms at 4,000, on a single thread that every other request is queued behind.
  //
  // Residency here is the same rule `agentsInRegion` applies (region match, treasury
  // excluded); its id-sort is not reproduced because nothing below depends on order —
  // `gini` sorts its own input, and the rest is a count.
  const residentCurrencyByRegion = new Map<string, number[]>();
  const treasuryByRegion = new Map<string, number>();
  for (const a of agents) {
    if (a.role === "treasury") {
      // First one wins, matching the `find` this replaced. There is at most one per
      // region in practice — `treasuryId` is a fixed id and admission rejects duplicates.
      if (!treasuryByRegion.has(a.region)) treasuryByRegion.set(a.region, a.balances.currency);
      continue;
    }
    const bucket = residentCurrencyByRegion.get(a.region);
    if (bucket) bucket.push(a.balances.currency);
    else residentCurrencyByRegion.set(a.region, [a.balances.currency]);
  }

  const perRegion: RegionMetrics[] = regions.map((r) => {
    const currencies = residentCurrencyByRegion.get(r.id) ?? [];
    return {
      id: r.id,
      status: r.status,
      lifecycle: r.lifecycle,
      residents: currencies.length,
      treasury: treasuryByRegion.get(r.id) ?? 0,
      currencyGini: gini(currencies),
    };
  });

  const totalReputation = residents.reduce((s, a) => s + a.reputation, 0);

  return {
    tick: view.tick,
    regions: {
      total: regions.length,
      recognized: regions.filter((r) => r.status === "recognized").length,
      unrecognized: regions.filter((r) => r.status === "unrecognized").length,
      active: regions.filter((r) => r.lifecycle === "active").length,
      dormant: regions.filter((r) => r.lifecycle === "dormant").length,
    },
    agents: {
      total: agents.length,
      residents: residents.length,
      treasuries: agents.length - residents.length,
      totalCurrency: agents.reduce((s, a) => s + a.balances.currency, 0),
      totalCredit: agents.reduce((s, a) => s + a.balances.credit, 0),
      currencyGini: gini(residents.map((a) => a.balances.currency)),
      avgReputation: residents.length === 0 ? 0 : totalReputation / residents.length,
    },
    perRegion,
    // Mobility / secession are the RFC 0002 dependent variables. Secession is a founding by an
    // emergence proposer (§3-D); regions are never deleted, so the current region set is the
    // full founding history. Migrations and ownership transfers are counted from the log.
    mobility: {
      migrations,
      secessions: regions.filter((r) => r.proposer.kind === "emergence").length,
      ownershipTransfers,
    },
    trust: { vouches },
    log: { length: view.log.length, digest: view.log.digest(), eventTypes },
  };
}
