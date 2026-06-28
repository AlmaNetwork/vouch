/**
 * ALMA ID System
 *
 * ID formats:
 * - region_id = any-name 1*( '.' region ) | "[" <IP> | <Network-Domain> "]"
 * - account_id = any-name '@' region
 * - asset_type_id = region '/' any-name
 * - asset_id = account_id '/' asset_type_name '#' any-name
 *
 * Examples:
 * - Region: tokyo, chiyoda.tokyo, [192.168.1.1]
 * - Account: mizuki@tokyo, alice@chiyoda.tokyo
 * - AssetType: tokyo/credit, chiyoda.tokyo/tea
 * - Asset: mizuki@tokyo/credit#default, alice@chiyoda.tokyo/tea#green
 */

import { z } from "zod";

// Branded types for type safety
declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type RegionId = Brand<string, "RegionId">;
export type AccountId = Brand<string, "AccountId">;
export type AssetTypeId = Brand<string, "AssetTypeId">;
export type AssetId = Brand<string, "AssetId">;
export type LawId = Brand<string, "LawId">;
export type InviteId = Brand<string, "InviteId">;
export type GroupId = Brand<string, "GroupId">;

// Character validation for ALMA names
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Validate a name component (alphanumeric, hyphen, underscore) */
function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

// ============================================================
// Region ID
// ============================================================

export interface ParsedRegionId {
  raw: string;
  segments: string[];
  isNetwork: boolean;
}

export function parseRegionId(raw: string): ParsedRegionId | null {
  if (!raw) return null;

  // Network notation: [192.168.1.1] or [example.com]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return {
      raw,
      segments: [raw],
      isNetwork: true,
    };
  }

  // Hierarchical notation: chiyoda.tokyo
  const segments = raw.split(".");
  if (!segments.every(isValidName)) return null;

  return {
    raw,
    segments,
    isNetwork: false,
  };
}

export function createRegionId(raw: string): RegionId {
  const parsed = parseRegionId(raw);
  if (!parsed) {
    throw new Error(`Invalid region ID: ${raw}`);
  }
  return raw as RegionId;
}

export const regionIdSchema = z.string().refine(
  (val) => parseRegionId(val) !== null,
  { message: "Invalid region ID format" }
).transform((val) => val as RegionId);

// ============================================================
// Account ID
// ============================================================

export interface ParsedAccountId {
  raw: string;
  name: string;
  region: ParsedRegionId;
}

export function parseAccountId(raw: string): ParsedAccountId | null {
  const atIndex = raw.indexOf("@");
  if (atIndex === -1) return null;

  const name = raw.substring(0, atIndex);
  const regionStr = raw.substring(atIndex + 1);

  if (!isValidName(name)) return null;

  const region = parseRegionId(regionStr);
  if (!region) return null;

  return {
    raw,
    name,
    region,
  };
}

export function createAccountId(name: string, region: RegionId | string): AccountId {
  const raw = `${name}@${region}`;
  const parsed = parseAccountId(raw);
  if (!parsed) {
    throw new Error(`Invalid account ID: ${raw}`);
  }
  return raw as AccountId;
}

export function accountIdFromRaw(raw: string): AccountId {
  const parsed = parseAccountId(raw);
  if (!parsed) {
    throw new Error(`Invalid account ID: ${raw}`);
  }
  return raw as AccountId;
}

export const accountIdSchema = z.string().refine(
  (val) => parseAccountId(val) !== null,
  { message: "Invalid account ID format. Expected: name@region" }
).transform((val) => val as AccountId);

// ============================================================
// Asset Type ID
// ============================================================

export interface ParsedAssetTypeId {
  raw: string;
  region: ParsedRegionId;
  typeName: string;
}

export function parseAssetTypeId(raw: string): ParsedAssetTypeId | null {
  const slashIndex = raw.indexOf("/");
  if (slashIndex === -1) return null;

  const regionStr = raw.substring(0, slashIndex);
  const typeName = raw.substring(slashIndex + 1);

  const region = parseRegionId(regionStr);
  if (!region) return null;

  if (!isValidName(typeName)) return null;

  return {
    raw,
    region,
    typeName,
  };
}

export function createAssetTypeId(region: RegionId | string, typeName: string): AssetTypeId {
  const raw = `${region}/${typeName}`;
  const parsed = parseAssetTypeId(raw);
  if (!parsed) {
    throw new Error(`Invalid asset type ID: ${raw}`);
  }
  return raw as AssetTypeId;
}

export const assetTypeIdSchema = z.string().refine(
  (val) => parseAssetTypeId(val) !== null,
  { message: "Invalid asset type ID format. Expected: region/type-name" }
).transform((val) => val as AssetTypeId);

// ============================================================
// Asset ID
// ============================================================

export interface ParsedAssetId {
  raw: string;
  account: ParsedAccountId;
  assetTypeName: string;
  instanceName: string;
  query?: Record<string, string>;
}

export function parseAssetId(raw: string): ParsedAssetId | null {
  // Handle query parameters
  let queryStr: string | undefined;
  let mainPart = raw;

  const queryIndex = raw.indexOf("?");
  if (queryIndex !== -1) {
    queryStr = raw.substring(queryIndex + 1);
    mainPart = raw.substring(0, queryIndex);
  }

  // Parse: account_id / asset_type_name # instance_name
  const hashIndex = mainPart.indexOf("#");
  if (hashIndex === -1) return null;

  const instanceName = mainPart.substring(hashIndex + 1);
  const beforeHash = mainPart.substring(0, hashIndex);

  const slashIndex = beforeHash.indexOf("/");
  if (slashIndex === -1) return null;

  const accountStr = beforeHash.substring(0, slashIndex);
  const assetTypeName = beforeHash.substring(slashIndex + 1);

  const account = parseAccountId(accountStr);
  if (!account) return null;

  if (!isValidName(assetTypeName)) return null;
  if (!isValidName(instanceName)) return null;

  // Parse query parameters
  let query: Record<string, string> | undefined;
  if (queryStr) {
    query = {};
    const pairs = queryStr.split("&");
    for (const pair of pairs) {
      const [key, value] = pair.split("=");
      if (key && value) {
        query[key] = decodeURIComponent(value);
      }
    }
  }

  return {
    raw,
    account,
    assetTypeName,
    instanceName,
    query,
  };
}

export function createAssetId(
  account: AccountId | string,
  assetTypeName: string,
  instanceName: string
): AssetId {
  const raw = `${account}/${assetTypeName}#${instanceName}`;
  const parsed = parseAssetId(raw);
  if (!parsed) {
    throw new Error(`Invalid asset ID: ${raw}`);
  }
  return raw as AssetId;
}

export const assetIdSchema = z.string().refine(
  (val) => parseAssetId(val) !== null,
  { message: "Invalid asset ID format. Expected: account@region/type#instance" }
).transform((val) => val as AssetId);

// ============================================================
// Resident ID (UUID format, kept for backward compatibility)
// ============================================================

export type ResidentId = Brand<string, "ResidentId">;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseResidentId(raw: string): { raw: string } | null {
  if (!UUID_PATTERN.test(raw)) return null;
  return { raw };
}

export function createResidentId(raw?: string): ResidentId {
  const id = raw ?? crypto.randomUUID();
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`Invalid resident ID: ${id}`);
  }
  return id as ResidentId;
}

export const residentIdSchema = z.string().uuid().transform((val) => val as ResidentId);

// ============================================================
// Law ID (format: region/law-name)
// ============================================================

export interface ParsedLawId {
  raw: string;
  region: ParsedRegionId;
  lawName: string;
}

export function parseLawId(raw: string): ParsedLawId | null {
  const slashIndex = raw.indexOf("/");
  if (slashIndex === -1) return null;

  const regionStr = raw.substring(0, slashIndex);
  const lawName = raw.substring(slashIndex + 1);

  const region = parseRegionId(regionStr);
  if (!region) return null;

  if (!isValidName(lawName)) return null;

  return {
    raw,
    region,
    lawName,
  };
}

export function createLawId(region: RegionId | string, lawName: string): LawId {
  const raw = `${region}/${lawName}`;
  const parsed = parseLawId(raw);
  if (!parsed) {
    throw new Error(`Invalid law ID: ${raw}`);
  }
  return raw as LawId;
}

export const lawIdSchema = z.string().refine(
  (val) => parseLawId(val) !== null,
  { message: "Invalid law ID format. Expected: region/law-name" }
).transform((val) => val as LawId);

export function isLawId(value: string): value is LawId {
  return parseLawId(value) !== null;
}

// ============================================================
// Invite ID (UUID format)
// ============================================================

export function parseInviteId(raw: string): { raw: string } | null {
  if (!UUID_PATTERN.test(raw)) return null;
  return { raw };
}

export function createInviteId(raw?: string): InviteId {
  const id = raw ?? crypto.randomUUID();
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`Invalid invite ID: ${id}`);
  }
  return id as InviteId;
}

export const inviteIdSchema = z.string().uuid().transform((val) => val as InviteId);

export function isInviteId(value: string): value is InviteId {
  return parseInviteId(value) !== null;
}

// ============================================================
// Group ID (format: region/group-name)
// ============================================================

export interface ParsedGroupId {
  raw: string;
  region: ParsedRegionId;
  groupName: string;
}

export function parseGroupId(raw: string): ParsedGroupId | null {
  const slashIndex = raw.indexOf("/");
  if (slashIndex === -1) return null;

  const regionStr = raw.substring(0, slashIndex);
  const groupName = raw.substring(slashIndex + 1);

  const region = parseRegionId(regionStr);
  if (!region) return null;

  if (!isValidName(groupName)) return null;

  return {
    raw,
    region,
    groupName,
  };
}

export function createGroupId(region: RegionId | string, groupName: string): GroupId {
  const raw = `${region}/${groupName}`;
  const parsed = parseGroupId(raw);
  if (!parsed) {
    throw new Error(`Invalid group ID: ${raw}`);
  }
  return raw as GroupId;
}

export const groupIdSchema = z.string().refine(
  (val) => parseGroupId(val) !== null,
  { message: "Invalid group ID format. Expected: region/group-name" }
).transform((val) => val as GroupId);

export function isGroupId(value: string): value is GroupId {
  return parseGroupId(value) !== null;
}

// ============================================================
// Type guards
// ============================================================

export function isRegionId(value: string): value is RegionId {
  return parseRegionId(value) !== null;
}

export function isAccountId(value: string): value is AccountId {
  return parseAccountId(value) !== null;
}

export function isAssetTypeId(value: string): value is AssetTypeId {
  return parseAssetTypeId(value) !== null;
}

export function isAssetId(value: string): value is AssetId {
  return parseAssetId(value) !== null;
}

export function isResidentId(value: string): value is ResidentId {
  return parseResidentId(value) !== null;
}

// ============================================================
// Utility functions
// ============================================================

/** Get the region from any ALMA ID */
export function getRegion(id: AccountId | AssetTypeId | AssetId): RegionId {
  if (isAccountId(id)) {
    const parsed = parseAccountId(id);
    return parsed!.region.raw as RegionId;
  }
  if (isAssetTypeId(id)) {
    const parsed = parseAssetTypeId(id);
    return parsed!.region.raw as RegionId;
  }
  if (isAssetId(id)) {
    const parsed = parseAssetId(id);
    return parsed!.account.region.raw as RegionId;
  }
  throw new Error(`Cannot extract region from ID: ${id}`);
}

/** Check if account belongs to region */
export function accountBelongsToRegion(accountId: AccountId, regionId: RegionId): boolean {
  const parsed = parseAccountId(accountId);
  if (!parsed) return false;
  return parsed.region.raw === regionId;
}
