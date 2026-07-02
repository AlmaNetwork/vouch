/**
 * Core domain types for the Network node
 */

import type { AccountId, AssetId, AssetTypeId, GroupId, InviteId, LawId, RegionId, ResidentId } from "./almaId.js";

// Re-export ALMA ID types
export type { AccountId, AssetId, AssetTypeId, GroupId, InviteId, LawId, RegionId, ResidentId };

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

/** Asset kind - determines behavior */
export type AssetKind = "fungible" | "credential" | "nft";

/** Asset instance status */
export type AssetStatus = "active" | "expired" | "revoked" | "disposed";

/** Law status */
export type LawStatus = "active" | "abolished";

/** Invite status */
export type InviteStatus = "pending" | "accepted" | "expired" | "revoked";

/** Group status */
export type GroupStatus = "active" | "dissolved";

/** Group member role within the group */
export type GroupMemberRole = "leader" | "member";

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

  /** Asset kind */
  kind: AssetKind;

  /** Decimal precision for amounts (fungible) */
  precision: number;
  /** Whether the asset can have negative balance (fungible) */
  allowNegative: boolean;

  /** Schema for claims (credential/nft) */
  schema: Record<string, unknown> | null;
  /** Whether the asset can be transferred */
  transferable: boolean;
  /** Whether the asset can expire */
  expirable: boolean;

  /** Account that defined this type (has issue permission) */
  issuerId: AccountId;

  createdAt: string;
  updatedAt: string;
}

/** Asset model - an instance of an asset type owned by an account */
export interface Asset {
  id: AssetId;
  accountId: AccountId;
  assetTypeId: AssetTypeId;

  /** Account that issued this asset (has revoke permission) */
  issuerId: AccountId;

  /** Balance as string for precision (fungible) */
  balance: string;

  /** Claims data (credential/nft) */
  claims: Record<string, unknown> | null;
  /** Expiration date (if expirable) */
  expiresAt: string | null;

  /** Current status */
  status: AssetStatus;

  /** Metadata for the asset */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Law model - defines rules that the system auto-enforces
 *
 * Laws can define:
 * - Constraints on commands (e.g., max transaction amount)
 * - Required conditions (e.g., must have credential to transact)
 * - Automatic triggers (e.g., fee on transaction)
 */
export interface Law {
  id: LawId;
  regionId: RegionId;
  name: string;
  description: string;

  /** Law type determines enforcement mechanism */
  lawType: LawType;

  /** The rule definition (JSON-based DSL) */
  rule: LawRule;

  /** Who created this law */
  createdBy: AccountId;

  /** Current status */
  status: LawStatus;

  /** Effective date (null = immediate) */
  effectiveAt: string | null;

  createdAt: string;
  updatedAt: string;
}

/** Types of laws */
export type LawType =
  | "constraint" // Prevents commands that violate conditions
  | "requirement" // Requires certain conditions to be met
  | "trigger"; // Automatically executes actions

/** Law rule definition */
export interface LawRule {
  /** Target command(s) this law applies to */
  target: string | string[];

  /** Condition expression (JSON-based) */
  condition?: Record<string, unknown>;

  /** Action to take (for triggers) */
  action?: Record<string, unknown>;

  /** Error message when law is violated */
  message?: string;
}

/**
 * Invite model - represents an invitation to join the network
 */
export interface Invite {
  id: InviteId;
  regionId: RegionId;

  /** Email address the invite was sent to */
  email: string;

  /** Who created this invite */
  invitedBy: AccountId;

  /** Roles to grant upon acceptance */
  roles: Role[];

  /** Current status */
  status: InviteStatus;

  /** Expiration date */
  expiresAt: string;

  /** When the invite was accepted (if accepted) */
  acceptedAt: string | null;

  /** Account created from this invite (if accepted) */
  acceptedAccountId: AccountId | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * Group model - represents an organization/team within the network
 *
 * Groups can be used for:
 * - Permission management (access control)
 * - Community organization
 * - Workflow assignment
 */
export interface Group {
  id: GroupId;
  regionId: RegionId;
  name: string;
  description: string;

  /** Group type for categorization */
  groupType: GroupType;

  /** Members of the group */
  members: GroupMember[];

  /** Permissions granted to this group */
  permissions: string[];

  /** Who created this group */
  createdBy: AccountId;

  /** Current status */
  status: GroupStatus;

  createdAt: string;
  updatedAt: string;
}

/** Types of groups */
export type GroupType =
  | "team" // Work team
  | "department" // Organizational department
  | "committee" // Decision-making committee
  | "community"; // Social/community group

/** Group member */
export interface GroupMember {
  accountId: AccountId;
  role: GroupMemberRole;
  joinedAt: string;
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
  laws: Map<LawId, Law>;
  invites: Map<InviteId, Invite>;
  groups: Map<GroupId, Group>;
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
    laws: new Map(),
    invites: new Map(),
    groups: new Map(),
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

/** Check if law exists */
export function hasLaw(state: NetworkState, lawId: LawId): boolean {
  return state.laws.has(lawId);
}

/** Get law or undefined */
export function getLaw(state: NetworkState, lawId: LawId): Law | undefined {
  return state.laws.get(lawId);
}

/** Check if invite exists */
export function hasInvite(state: NetworkState, inviteId: InviteId): boolean {
  return state.invites.has(inviteId);
}

/** Get invite or undefined */
export function getInvite(state: NetworkState, inviteId: InviteId): Invite | undefined {
  return state.invites.get(inviteId);
}

/** Find invite by email */
export function getInviteByEmail(state: NetworkState, email: string): Invite | undefined {
  for (const invite of state.invites.values()) {
    if (invite.email === email && invite.status === "pending") {
      return invite;
    }
  }
  return undefined;
}

/** Check if group exists */
export function hasGroup(state: NetworkState, groupId: GroupId): boolean {
  return state.groups.has(groupId);
}

/** Get group or undefined */
export function getGroup(state: NetworkState, groupId: GroupId): Group | undefined {
  return state.groups.get(groupId);
}
