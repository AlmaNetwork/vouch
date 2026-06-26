/**
 * Tests for ALMA ID system
 */

import { describe, it, expect } from "vitest";
import {
  parseRegionId,
  createRegionId,
  parseAccountId,
  createAccountId,
  accountIdFromRaw,
  parseAssetTypeId,
  createAssetTypeId,
  parseAssetId,
  createAssetId,
  getRegion,
  accountBelongsToRegion,
} from "./almaId.js";

describe("ALMA ID System", () => {
  describe("RegionId", () => {
    it("should parse simple region", () => {
      const parsed = parseRegionId("tokyo");
      expect(parsed).not.toBeNull();
      expect(parsed!.segments).toEqual(["tokyo"]);
      expect(parsed!.isNetwork).toBe(false);
    });

    it("should parse hierarchical region", () => {
      const parsed = parseRegionId("chiyoda.tokyo");
      expect(parsed).not.toBeNull();
      expect(parsed!.segments).toEqual(["chiyoda", "tokyo"]);
      expect(parsed!.isNetwork).toBe(false);
    });

    it("should parse deep hierarchical region", () => {
      const parsed = parseRegionId("nihonbashi.chuo.tokyo");
      expect(parsed).not.toBeNull();
      expect(parsed!.segments).toEqual(["nihonbashi", "chuo", "tokyo"]);
    });

    it("should parse network notation with IP", () => {
      const parsed = parseRegionId("[192.168.1.1]");
      expect(parsed).not.toBeNull();
      expect(parsed!.isNetwork).toBe(true);
    });

    it("should parse network notation with domain", () => {
      const parsed = parseRegionId("[example.com]");
      expect(parsed).not.toBeNull();
      expect(parsed!.isNetwork).toBe(true);
    });

    it("should reject invalid characters", () => {
      expect(parseRegionId("tokyo!")).toBeNull();
      expect(parseRegionId("tokyo@region")).toBeNull();
    });

    it("should create valid region ID", () => {
      const regionId = createRegionId("tokyo");
      expect(regionId).toBe("tokyo");
    });

    it("should throw on invalid region ID", () => {
      expect(() => createRegionId("")).toThrow();
      expect(() => createRegionId("invalid@region")).toThrow();
    });
  });

  describe("AccountId", () => {
    it("should parse simple account", () => {
      const parsed = parseAccountId("mizuki@tokyo");
      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe("mizuki");
      expect(parsed!.region.raw).toBe("tokyo");
    });

    it("should parse account with hierarchical region", () => {
      const parsed = parseAccountId("alice@chiyoda.tokyo");
      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe("alice");
      expect(parsed!.region.segments).toEqual(["chiyoda", "tokyo"]);
    });

    it("should parse account with network region", () => {
      const parsed = parseAccountId("bob@[192.168.1.1]");
      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe("bob");
      expect(parsed!.region.isNetwork).toBe(true);
    });

    it("should reject account without @", () => {
      expect(parseAccountId("mizukitokyo")).toBeNull();
    });

    it("should reject account with invalid name", () => {
      expect(parseAccountId("@tokyo")).toBeNull();
      expect(parseAccountId("mizu!ki@tokyo")).toBeNull();
    });

    it("should create account ID from components", () => {
      const regionId = createRegionId("tokyo");
      const accountId = createAccountId("mizuki", regionId);
      expect(accountId).toBe("mizuki@tokyo");
    });

    it("should create account ID from raw string", () => {
      const accountId = accountIdFromRaw("mizuki@tokyo");
      expect(accountId).toBe("mizuki@tokyo");
    });
  });

  describe("AssetTypeId", () => {
    it("should parse simple asset type", () => {
      const parsed = parseAssetTypeId("tokyo/credit");
      expect(parsed).not.toBeNull();
      expect(parsed!.region.raw).toBe("tokyo");
      expect(parsed!.typeName).toBe("credit");
    });

    it("should parse asset type with hierarchical region", () => {
      const parsed = parseAssetTypeId("chiyoda.tokyo/tea");
      expect(parsed).not.toBeNull();
      expect(parsed!.region.segments).toEqual(["chiyoda", "tokyo"]);
      expect(parsed!.typeName).toBe("tea");
    });

    it("should reject asset type without /", () => {
      expect(parseAssetTypeId("tokyo-credit")).toBeNull();
    });

    it("should create asset type ID", () => {
      const regionId = createRegionId("tokyo");
      const assetTypeId = createAssetTypeId(regionId, "credit");
      expect(assetTypeId).toBe("tokyo/credit");
    });
  });

  describe("AssetId", () => {
    it("should parse simple asset ID", () => {
      const parsed = parseAssetId("mizuki@tokyo/credit#default");
      expect(parsed).not.toBeNull();
      expect(parsed!.account.name).toBe("mizuki");
      expect(parsed!.account.region.raw).toBe("tokyo");
      expect(parsed!.assetTypeName).toBe("credit");
      expect(parsed!.instanceName).toBe("default");
    });

    it("should parse asset ID with hierarchical region", () => {
      const parsed = parseAssetId("alice@chiyoda.tokyo/tea#green");
      expect(parsed).not.toBeNull();
      expect(parsed!.account.name).toBe("alice");
      expect(parsed!.account.region.segments).toEqual(["chiyoda", "tokyo"]);
      expect(parsed!.assetTypeName).toBe("tea");
      expect(parsed!.instanceName).toBe("green");
    });

    it("should parse asset ID with query parameters", () => {
      const parsed = parseAssetId("mizuki@tokyo/credit#default?version=1");
      expect(parsed).not.toBeNull();
      expect(parsed!.query).toEqual({ version: "1" });
    });

    it("should parse asset ID with multiple query parameters", () => {
      const parsed = parseAssetId("mizuki@tokyo/credit#default?version=1&type=primary");
      expect(parsed).not.toBeNull();
      expect(parsed!.query).toEqual({ version: "1", type: "primary" });
    });

    it("should reject asset ID without #", () => {
      expect(parseAssetId("mizuki@tokyo/credit")).toBeNull();
    });

    it("should create asset ID", () => {
      const accountId = accountIdFromRaw("mizuki@tokyo");
      const assetId = createAssetId(accountId, "credit", "default");
      expect(assetId).toBe("mizuki@tokyo/credit#default");
    });
  });

  describe("Utility functions", () => {
    describe("getRegion", () => {
      it("should get region from account ID", () => {
        const accountId = accountIdFromRaw("mizuki@tokyo");
        const region = getRegion(accountId);
        expect(region).toBe("tokyo");
      });

      it("should get region from asset type ID", () => {
        const assetTypeId = createAssetTypeId("chiyoda.tokyo", "tea");
        const region = getRegion(assetTypeId);
        expect(region).toBe("chiyoda.tokyo");
      });

      it("should get region from asset ID", () => {
        const assetId = createAssetId("alice@chiyoda.tokyo", "tea", "green");
        const region = getRegion(assetId);
        expect(region).toBe("chiyoda.tokyo");
      });
    });

    describe("accountBelongsToRegion", () => {
      it("should return true when account belongs to region", () => {
        const accountId = accountIdFromRaw("mizuki@tokyo");
        const regionId = createRegionId("tokyo");
        expect(accountBelongsToRegion(accountId, regionId)).toBe(true);
      });

      it("should return false when account does not belong to region", () => {
        const accountId = accountIdFromRaw("mizuki@tokyo");
        const regionId = createRegionId("osaka");
        expect(accountBelongsToRegion(accountId, regionId)).toBe(false);
      });

      it("should handle hierarchical regions", () => {
        const accountId = accountIdFromRaw("alice@chiyoda.tokyo");
        const regionId = createRegionId("chiyoda.tokyo");
        expect(accountBelongsToRegion(accountId, regionId)).toBe(true);

        const parentRegion = createRegionId("tokyo");
        expect(accountBelongsToRegion(accountId, parentRegion)).toBe(false);
      });
    });
  });
});
