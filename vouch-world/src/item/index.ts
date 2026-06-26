// A small domain slice (P3): DIGITAL ITEMS — a unique tradeable asset distinct from currency,
// tracked by an event-sourced ownership ledger (itemId -> owner). Like region/agent, this layer
// imports only foundation; the environment owns the write path (mint/transfer).
//
// An item is owned by an AGENT (name@region) — the same principals that hold currency. Items are
// unique (a deed/NFT-like asset), NOT a fungible quota. The reducer gates at the top on
// SYSTEM_ACTOR, so a forged item event is ignored (live + replay).

import { SYSTEM_ACTOR, type Reducer } from "../foundation";

export interface ItemState {
  readonly id: string;
  readonly kind: string; // an opaque item type tag (e.g. "deed", "badge")
  readonly owner: string; // the agent (name@region) that holds it
}

/** The item read-model slice; the environment composes it into world state. */
export type ItemSlice = { readonly items: Readonly<Record<string, ItemState>> };

export const EVENT_ITEM_MINTED = "item.minted"; // env-authored: a new item enters the ledger
export const EVENT_ITEM_TRANSFERRED = "item.transferred"; // env-authored: ownership moves

export type ItemMintedPayload = { itemId: string; kind: string; owner: string };
export type ItemTransferredPayload = { itemId: string; from: string; to: string };

export const itemReducer: Reducer<ItemSlice> = (state, event) => {
  // Defence in depth (audit G8): item events are env-authored; a forged non-system event is ignored.
  if (event.actor !== SYSTEM_ACTOR) return state;
  switch (event.type) {
    case EVENT_ITEM_MINTED: {
      const p = event.payload as ItemMintedPayload;
      if (state.items[p.itemId]) return state; // never overwrite an existing item
      return { items: { ...state.items, [p.itemId]: { id: p.itemId, kind: p.kind, owner: p.owner } } };
    }
    case EVENT_ITEM_TRANSFERRED: {
      const p = event.payload as ItemTransferredPayload;
      const existing = state.items[p.itemId];
      if (!existing) return state;
      return { items: { ...state.items, [p.itemId]: { ...existing, owner: p.to } } };
    }
    default:
      return state;
  }
};

// --- selectors (read-only) ---
export function getItem(state: ItemSlice, id: string): ItemState | undefined {
  return state.items[id];
}
export function listItems(state: ItemSlice): ItemState[] {
  return Object.values(state.items);
}
/** Items held by an agent, id-sorted for determinism. */
export function itemsOwnedBy(state: ItemSlice, owner: string): ItemState[] {
  return listItems(state)
    .filter((i) => i.owner === owner)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}
