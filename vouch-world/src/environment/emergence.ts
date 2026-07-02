// Layer 4 Environment — §3-D internal emergence (secession by institutional mismatch).
//
// A self-contained rule, separated from the tick-loop driver: group the agents whose
// value profile clashes with their region; any cohort at/above critical mass SECEDES
// via the SAME founding engine (an emergence proposer), then migrates into the new
// region. The driver calls `detectEmergence` once per tick.

import { type AgentState, listAgents } from "../agent";
import type { World } from "../foundation";
import { defineRegion, getRegion, makeInstitutions, type RegionState } from "../region";
import { emergenceProposal, proposeFounding } from "./founding";
import { admitTreasury, immigrate } from "./population";
import type { WorldState } from "./state";

/** A region's institutional leaning, derived from its verification policy. */
export function regionStance(region: RegionState): "strict" | "lenient" {
  return region.institutions.verificationPolicy.rejectUnknownSchemas ? "strict" : "lenient";
}

/**
 * §3-D internal emergence. Groups dissatisfied agents (value profile != region
 * stance) by (region, profile); any group at/above critical mass SECEDES via the
 * SAME founding engine (audit-confirmed reuse), with institutions embodying the
 * dissatisfaction, then migrates there (which resolves the mismatch).
 *
 * The region is FOUNDED once per (region, profile); a later dissatisfied wave
 * immigrates into the existing region (§3-C) rather than being stranded (EMG-1).
 */
export function detectEmergence(env: World<WorldState>, criticalMass: number): void {
  const state = env.getState();
  const groups = new Map<string, AgentState[]>();
  for (const a of listAgents(state)) {
    if (a.role === "treasury") continue;
    const region = getRegion(state, a.region);
    if (!region) continue;
    if (a.valueProfile === regionStance(region)) continue; // satisfied
    const key = `${a.region}::${a.valueProfile}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(a);
    else groups.set(key, [a]);
  }

  for (const [key, bucket] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (bucket.length < criticalMass) continue;
    const [sourceRegion, profile] = key.split("::") as [string, "strict" | "lenient"];
    // EMG-3: deterministic cohort order (don't lean on Object.values insertion order).
    const cohort = [...bucket].sort((a, b) => (a.id < b.id ? -1 : 1));
    const newId = `${profile}${sourceRegion}`; // deterministic, lowercase alnum

    // EMG-1: found the region ONCE; ALWAYS migrate the current cohort into it, so a
    // later wave immigrates rather than being silently stranded.
    if (!getRegion(env.getState(), newId)) {
      // Emergence inheritance: the seceded village INHERITS the parent's certificate
      // vocabulary (schemaLedger), and translates the parent's certs into its local
      // vocabulary (a "map" diplomacy override toward the source). The dissatisfaction
      // still shapes its verification stance (strict ⇄ lenient). The cohort carries its
      // own balances/credentials across (immigration preserves them).
      const parent = getRegion(env.getState(), sourceRegion);
      const institutions = makeInstitutions({
        schemaLedger: parent ? parent.institutions.schemaLedger : [],
        verificationPolicy:
          profile === "strict"
            ? { acceptedSchemaIds: [], rejectUnknownSchemas: true }
            : { acceptedSchemaIds: [], rejectUnknownSchemas: false },
        diplomacyPolicy: { defaultStance: profile === "strict" ? "reexamine" : "absorb", overrides: { [sourceRegion]: "map" } },
      });

      const def = defineRegion(newId, `${profile} secession from ${sourceRegion}`, institutions);
      proposeFounding(
        env,
        emergenceProposal(
          def,
          sourceRegion,
          `institutional mismatch: ${profile} cohort`,
          cohort.map((a) => a.id),
        ),
      );
      admitTreasury(env, newId);
    }
    for (const a of cohort) immigrate(env, a.id, newId);
  }
}
