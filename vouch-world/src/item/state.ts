// Item slice (P3): DIGITAL ITEMS — a unique tradeable asset distinct from currency,
// tracked by an event-sourced ownership ledger (itemId -> owner). Types + reducer +
// selectors, mirroring region/state.ts; index.ts re-exports this as the public surface.
//
// An item is owned by an AGENT (name@region) — the same principals that hold currency.
// Items are unique (a deed/NFT-like asset), NOT a fungible quota. The reducer gates at
// the top on SYSTEM_ACTOR, so a forged item event is ignored (live + replay).

import { type Reducer, SYSTEM_ACTOR } from "../foundation";

export interface ItemState {
  readonly id: string;
  readonly kind: string; // an opaque item type tag (e.g. "deed", "badge")
  readonly owner: string; // the agent (name@region) that holds it
}

/** The item read-model slice; the environment composes it into world state. */
export type ItemSlice = { readonly items: Readonly<Record<string, ItemState>> };

export const EVENT_ITEM_MINTED = "item.minted"; // env-authored: a new item enters the ledger
export const EVENT_ITEM_TRANSFERRED = "item.transferred"; // env-authored: ownership moves

// Length bounds, checked at the write path (environment/items.ts mintItem — validation
// in this codebase lives with the mutator that commits, like MAX_DISPLAY_NAME_LENGTH).
// An item id and its kind tag are journalled forever and echoed on every transfer, so
// without bounds one mint parks an arbitrarily large string in a hash-chained log that
// can never be trimmed — the same class of surface as the identifier grammar.

/** Longest item id. Ids are chosen by the minter, so free text with only length for a grammar. */
export const MAX_ITEM_ID_LENGTH = 128;
/** Longest item `kind` tag. A vocabulary word ("deed", "badge"), not a description. */
export const MAX_ITEM_KIND_LENGTH = 64;

export type ItemMintedPayload = { readonly itemId: string; readonly kind: string; readonly owner: string };
export type ItemTransferredPayload = { readonly itemId: string; readonly from: string; readonly to: string };

/** Maps each item-slice event type to its payload — the typed `commit` helper keys off this. */
export interface ItemEventMap {
  [EVENT_ITEM_MINTED]: ItemMintedPayload;
  [EVENT_ITEM_TRANSFERRED]: ItemTransferredPayload;
}

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
