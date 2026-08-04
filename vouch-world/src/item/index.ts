// Layer 2/3 Item — public surface (barrel). Implementation lives in state.ts,
// mirroring the region slice. Imports only foundation; the environment (layer 4)
// owns the write path (mint/transfer).

export {
  EVENT_ITEM_MINTED,
  EVENT_ITEM_TRANSFERRED,
  getItem,
  type ItemEventMap,
  type ItemMintedPayload,
  type ItemSlice,
  type ItemState,
  type ItemTransferredPayload,
  itemReducer,
  itemsOwnedBy,
  listItems,
  MAX_ITEM_ID_LENGTH,
  MAX_ITEM_KIND_LENGTH,
} from "./state";
