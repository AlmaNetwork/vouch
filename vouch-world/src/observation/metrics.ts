// Layer 5 Observation — read-only metrics (§2-6). Pure functions over a read-only
// world view; they NEVER write. These are the first lenses (§5): economy, trust,
// diplomacy, and the log itself.

import type { WorldState } from "../environment";
import type { WorldView } from "../foundation";
import { listAgents } from "../agent";
import { listRegions } from "../region";

/** Gini coefficient of a list of non-negative values (0 = equal, ~1 = concentrated). */
export function gini(values: readonly number[]): number {
  const v = values.filter((x) => x >= 0).slice().sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return 0;
  const sum = v.reduce((s, x) => s + x, 0);
  if (sum === 0) return 0;
  let cumulative = 0;
  for (let i = 0; i < n; i++) cumulative += (i + 1) * v[i]!;
  return (2 * cumulative) / (n * sum) - (n + 1) / n;
}

export interface Metrics {
  tick: number;
  regions: { total: number; recognized: number; unrecognized: number };
  agents: { total: number; residents: number; treasuries: number; totalCurrency: number; totalCredit: number; currencyGini: number };
  log: { length: number; digest: string; eventTypes: Record<string, number> };
}

/** Derive observation metrics from a read-only world view. Reads only. */
export function metrics(view: WorldView<WorldState>): Metrics {
  const state = view.getState();
  const regions = listRegions(state);
  const agents = listAgents(state);
  const residents = agents.filter((a) => a.role !== "treasury");

  const eventTypes: Record<string, number> = {};
  for (const e of view.log.all()) eventTypes[e.type] = (eventTypes[e.type] ?? 0) + 1;

  return {
    tick: view.tick,
    regions: {
      total: regions.length,
      recognized: regions.filter((r) => r.status === "recognized").length,
      unrecognized: regions.filter((r) => r.status === "unrecognized").length,
    },
    agents: {
      total: agents.length,
      residents: residents.length,
      treasuries: agents.length - residents.length,
      totalCurrency: agents.reduce((s, a) => s + a.balances.currency, 0),
      totalCredit: agents.reduce((s, a) => s + a.balances.credit, 0),
      currencyGini: gini(residents.map((a) => a.balances.currency)),
    },
    log: { length: view.log.length, digest: view.log.digest(), eventTypes },
  };
}
