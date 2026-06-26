/**
 * Core domain types for the Network node
 */

import type {
  RegionId,
  AccountId,
  ResidentId,
  AssetTypeId,
  AssetId,
} from "./almaId.js";

// Re-export ALMA ID types
export type { RegionId, AccountId, ResidentId, AssetTypeId, AssetId };

/** Principal represents the authenticated identity making a request */
export interface Principal {
  accountId: AccountId;
  roles: Role[];
}

/** System principal for automated operations */
export const SYSTEM_PRINCIPAL: Principal = {
  accountId: "__system__" as AccountId,
  roles: ["system"],
};

/** Available roles in the system */
export type Role = "owner" | "resident" | "admin" | "system";

/** Account model - authentication entity */
export interface Account {
  id: AccountId;
  email: string;
  regionId: RegionId;
  residentId: ResidentId | null;
  roles: Role[];
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Resident model - a participant in the network */
export interface Resident {
  id: ResidentId;
  accountId: AccountId;
  regionId: RegionId;
  name: string;
  status: ResidentStatus;
  createdAt: string;
  updatedAt: string;
}

export type ResidentStatus = "pending" | "active" | "suspended";

/** Asset Type model - defines a class of assets in a region */
export interface AssetType {
  id: AssetTypeId;
  regionId: RegionId;
  name: string;
  description: string;
  /** Decimal precision for amounts */
  precision: number;
  /** Whether the asset can have negative balance */
  allowNegative: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Asset model - an instance of an asset type owned by an account */
export interface Asset {
  id: AssetId;
  accountId: AccountId;
  assetTypeId: AssetTypeId;
  /** Balance as string for precision */
  balance: string;
  /** Metadata for the asset */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Ledger entry for transactions */
export interface LedgerEntry {
  id: string;
  fromAccountId: AccountId;
  toAccountId: AccountId;
  assetTypeId: AssetTypeId;
  amount: string;
  memo: string;
  seq: number;
  createdAt: string;
}

/** Network state - the aggregate root */
export interface NetworkState {
  regionId: RegionId;
  ownerId: AccountId;
  name: string;
  accounts: Map<AccountId, Account>;
  residents: Map<ResidentId, Resident>;
  assetTypes: Map<AssetTypeId, AssetType>;
  assets: Map<AssetId, Asset>;
  ledger: LedgerEntry[];
  seq: number;
  lastHash: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Initial empty state factory */
export function createInitialState(): NetworkState {
  return {
    regionId: "" as RegionId,
    ownerId: "" as AccountId,
    name: "",
    accounts: new Map(),
    residents: new Map(),
    assetTypes: new Map(),
    assets: new Map(),
    ledger: [],
    seq: 0,
    lastHash: null,
    createdAt: "",
    updatedAt: "",
  };
}

/** Check if network is founded */
export function isNetworkFounded(state: NetworkState): boolean {
  return state.regionId !== "";
}

/** Check if account exists */
export function hasAccount(state: NetworkState, accountId: AccountId): boolean {
  return state.accounts.has(accountId);
}

/** Check if resident exists */
export function hasResident(state: NetworkState, residentId: ResidentId): boolean {
  return state.residents.has(residentId);
}

/** Check if asset type exists */
export function hasAssetType(state: NetworkState, assetTypeId: AssetTypeId): boolean {
  return state.assetTypes.has(assetTypeId);
}

/** Check if asset exists */
export function hasAsset(state: NetworkState, assetId: AssetId): boolean {
  return state.assets.has(assetId);
}

/** Get account or undefined */
export function getAccount(state: NetworkState, accountId: AccountId): Account | undefined {
  return state.accounts.get(accountId);
}

/** Get resident or undefined */
export function getResident(state: NetworkState, residentId: ResidentId): Resident | undefined {
  return state.residents.get(residentId);
}

/** Get asset type or undefined */
export function getAssetType(state: NetworkState, assetTypeId: AssetTypeId): AssetType | undefined {
  return state.assetTypes.get(assetTypeId);
}

/** Get asset or undefined */
export function getAsset(state: NetworkState, assetId: AssetId): Asset | undefined {
  return state.assets.get(assetId);
}
