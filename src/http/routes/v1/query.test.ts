/**
 * Tests for query endpoints (state, residents, ledger)
 */

import { existsSync, unlinkSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BootResult, boot } from "../../../boot.js";

describe("Query Endpoints", () => {
  let bootResult: BootResult;
  const testDbPath = "./test-query.db";

  beforeEach(async () => {
    cleanupDb();
    bootResult = boot({ dbPath: testDbPath });

    // Setup: found network and admit residents
    await request("/v1/found", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer account:owner-1",
      },
      body: JSON.stringify({
        regionId: "region-1",
        ownerEmail: "owner@example.com",
      }),
    });

    await request("/v1/admit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer account:owner-1",
      },
      body: JSON.stringify({
        accountId: "00000000-0000-0000-0000-000000000001",
        email: "user1@example.com",
        residentId: "00000000-0000-0000-0000-000000000011",
        name: "User 1",
      }),
    });

    await request("/v1/admit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer account:owner-1",
      },
      body: JSON.stringify({
        accountId: "00000000-0000-0000-0000-000000000002",
        email: "user2@example.com",
        residentId: "00000000-0000-0000-0000-000000000012",
        name: "User 2",
      }),
    });
  });

  afterEach(() => {
    bootResult.shutdown();
    cleanupDb();
  });

  function cleanupDb() {
    for (const suffix of ["", "-wal", "-shm"]) {
      const path = testDbPath + suffix;
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }
  }

  async function request(path: string, options: RequestInit = {}): Promise<Response> {
    const req = new Request(`http://localhost${path}`, options);
    return bootResult.app.fetch(req);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function json(res: Response): Promise<any> {
    return res.json();
  }

  describe("GET /v1/state", () => {
    it("should return network state", async () => {
      const res = await request("/v1/state", {
        headers: { Authorization: "Bearer account:owner-1" },
      });

      expect(res.status).toBe(200);
      const body = await json(res);

      expect(body.regionId).toBe("region-1");
      expect(body.ownerId).toBe("owner-1");
      expect(body.accountCount).toBe(3); // owner + 2 residents
      expect(body.residentCount).toBe(2);
      expect(body.seq).toBe(3); // found + 2 admits
    });

    it("should require authentication", async () => {
      const res = await request("/v1/state");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /v1/residents", () => {
    it("should return resident list", async () => {
      const res = await request("/v1/residents", {
        headers: { Authorization: "Bearer account:owner-1" },
      });

      expect(res.status).toBe(200);
      const body = await json(res);

      expect(body.residents).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.residents[0].name).toBe("User 1");
      expect(body.residents[1].name).toBe("User 2");
    });
  });

  describe("GET /v1/residents/:residentId", () => {
    it("should return specific resident", async () => {
      const res = await request("/v1/residents/00000000-0000-0000-0000-000000000011", {
        headers: { Authorization: "Bearer account:owner-1" },
      });

      expect(res.status).toBe(200);
      const body = await json(res);

      expect(body.id).toBe("00000000-0000-0000-0000-000000000011");
      expect(body.name).toBe("User 1");
      expect(body.status).toBe("active");
    });

    it("should return 404 for non-existent resident", async () => {
      const res = await request("/v1/residents/00000000-0000-0000-0000-000000000099", {
        headers: { Authorization: "Bearer account:owner-1" },
      });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /v1/ledger", () => {
    beforeEach(async () => {
      // Create some transactions
      await request("/v1/transact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:00000000-0000-0000-0000-000000000001",
        },
        body: JSON.stringify({
          fromResidentId: "00000000-0000-0000-0000-000000000011",
          toResidentId: "00000000-0000-0000-0000-000000000012",
          amount: "100",
          memo: "Payment 1",
        }),
      });

      await request("/v1/transact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:00000000-0000-0000-0000-000000000002",
        },
        body: JSON.stringify({
          fromResidentId: "00000000-0000-0000-0000-000000000012",
          toResidentId: "00000000-0000-0000-0000-000000000011",
          amount: "50",
          memo: "Payment 2",
        }),
      });
    });

    it("should return ledger entries", async () => {
      const res = await request("/v1/ledger", {
        headers: { Authorization: "Bearer account:owner-1" },
      });

      expect(res.status).toBe(200);
      const body = await json(res);

      expect(body.entries).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.entries[0].amount).toBe("100");
      expect(body.entries[1].amount).toBe("50");
    });

    it("should filter by residentId", async () => {
      const res = await request("/v1/ledger?residentId=00000000-0000-0000-0000-000000000011", {
        headers: { Authorization: "Bearer account:owner-1" },
      });

      expect(res.status).toBe(200);
      const body = await json(res);

      expect(body.entries).toHaveLength(2); // Both transactions involve resident 11
      expect(body.total).toBe(2);
    });

    it("should support pagination", async () => {
      const res = await request("/v1/ledger?limit=1&offset=0", {
        headers: { Authorization: "Bearer account:owner-1" },
      });

      expect(res.status).toBe(200);
      const body = await json(res);

      expect(body.entries).toHaveLength(1);
      expect(body.total).toBe(2);
      expect(body.limit).toBe(1);
      expect(body.offset).toBe(0);
    });
  });
});
