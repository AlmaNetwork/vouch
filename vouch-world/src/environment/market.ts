// Layer 4 Environment — the region market (P3): regions are OWNABLE INSTANCES that can be
// hibernated, listed, and sold — but NEVER deleted. "Defunct region -> sold on the market"
// (the meeting's instance-control). Ownership is the asset right (the account that holds the
// region), distinct from governance (who may amend its rules). So these are gated on isOwner,
// not canGovern.
//
// NOTE: settling the sale PRICE in currency is deferred — currency lives on agents
// (name@region) while ownership is account-scoped, so paying for a region needs the
// account<->agent value bridge (Track B). Here `price` is the recorded agreed amount; the
// transfer of CONTROL is the modeled mechanic.

import type { Result } from "../foundation";
import {
  EVENT_REGION_LIFECYCLE_CHANGED,
  EVENT_REGION_LISTED,
  EVENT_REGION_OWNERSHIP_TRANSFERRED,
  getRegion,
  isOwner,
  type RegionLifecycle,
  type RegionState,
} from "../region";
import type { WorldCommit } from "./state";

export type MarketResult = Result<{ region: RegionState }>;

function readBack(env: WorldCommit, regionId: string): MarketResult {
  const region = getRegion(env.getState(), regionId);
  if (!region) throw new Error("market: invariant violated — region missing after event");
  return { ok: true, region };
}

/** The owner hibernates / reactivates their region (active <-> dormant). Owner-only. */
export function setRegionLifecycle(env: WorldCommit, regionId: string, lifecycle: RegionLifecycle, by: string): MarketResult {
  const region = getRegion(env.getState(), regionId);
  if (!region) return { ok: false, reason: "unknown-region" };
  if (!isOwner(region, by)) return { ok: false, reason: "not-owner" };
  if (region.lifecycle === lifecycle) return { ok: true, region }; // idempotent
  env.commitSystem(EVENT_REGION_LIFECYCLE_CHANGED, { regionId, lifecycle });
  return readBack(env, regionId);
}

/** List a DORMANT region for sale at an asking price (or pass null to delist). Owner-only. */
export function listRegion(env: WorldCommit, regionId: string, salePrice: number | null, by: string): MarketResult {
  const region = getRegion(env.getState(), regionId);
  if (!region) return { ok: false, reason: "unknown-region" };
  if (!isOwner(region, by)) return { ok: false, reason: "not-owner" };
  if (salePrice === region.salePrice) return { ok: true, region }; // idempotent (incl. delist-when-unlisted)
  if (salePrice !== null && (!Number.isInteger(salePrice) || salePrice < 0)) return { ok: false, reason: "bad-price" };
  if (salePrice !== null && region.lifecycle !== "dormant") return { ok: false, reason: "not-dormant" };
  env.commitSystem(EVENT_REGION_LISTED, { regionId, salePrice });
  return readBack(env, regionId);
}

/**
 * Transfer a LISTED region's ownership to another account — a sale/handover. The region is
 * PRESERVED (never deleted): institutions, residents, and treasury all stay; only `owner`
 * changes, the region reactivates, and the listing clears. Owner-only; the region must be
 * listed. Currency settlement of the price is deferred (see file header).
 */
export function transferRegionOwnership(env: WorldCommit, regionId: string, to: string, by: string): MarketResult {
  const region = getRegion(env.getState(), regionId);
  if (!region) return { ok: false, reason: "unknown-region" };
  if (!isOwner(region, by)) return { ok: false, reason: "not-owner" };
  if (!to || to.trim() === "") return { ok: false, reason: "bad-recipient" };
  if (region.salePrice === null) return { ok: false, reason: "not-listed" };
  if (to === by) return { ok: false, reason: "already-owner" };
  // NOTE: `to` is not checked for existence — accounts are not first-class yet (Track B).
  env.commitSystem(EVENT_REGION_OWNERSHIP_TRANSFERRED, { regionId, from: by, to, price: region.salePrice });
  return readBack(env, regionId);
}
