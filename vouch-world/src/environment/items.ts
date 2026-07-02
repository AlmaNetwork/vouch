// Layer 4 Environment — the write path for DIGITAL ITEMS (P3): mint + transfer a unique,
// tradeable asset distinct from currency. Env-authored (commitSystem) + reducer-gated.
//
// Transfer is authorized by the current HOLDER. WHO may mint is left to the API layer
// (Track B) — at the domain level a mint just validates the item + recipient. Settling an
// item-for-currency atomic swap (an item trade) is a later refinement; here items move on
// their own ledger.

import { getAgent } from "../agent";
import type { Result } from "../foundation";
import { EVENT_ITEM_MINTED, EVENT_ITEM_TRANSFERRED, getItem } from "../item";
import type { WorldCommit } from "./state";

export type ItemResult = Result;

/** Mint a new unique item owned by an agent. itemId must be fresh; the owner must be a real agent. */
export function mintItem(env: WorldCommit, itemId: string, kind: string, owner: string): ItemResult {
  if (!itemId || !kind) return { ok: false, reason: "bad-item" };
  const state = env.getState();
  if (getItem(state, itemId)) return { ok: false, reason: "item-exists" };
  if (!getAgent(state, owner)) return { ok: false, reason: "unknown-agent" };
  env.commitSystem(EVENT_ITEM_MINTED, { itemId, kind, owner });
  return { ok: true };
}

/** Transfer an item to another agent. Authorized by the current HOLDER (`by` === the item's owner). */
export function transferItem(env: WorldCommit, itemId: string, to: string, by: string): ItemResult {
  const state = env.getState();
  const item = getItem(state, itemId);
  if (!item) return { ok: false, reason: "unknown-item" };
  if (item.owner !== by) return { ok: false, reason: "not-owner" };
  if (to === by) return { ok: false, reason: "already-owner" };
  if (!getAgent(state, to)) return { ok: false, reason: "unknown-agent" };
  env.commitSystem(EVENT_ITEM_TRANSFERRED, { itemId, from: by, to });
  return { ok: true };
}
