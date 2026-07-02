/**
 * Integration tests for HTTP API
 */

import { existsSync, unlinkSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BootResult, boot } from "../boot.js";

describe("HTTP API", () => {
  let bootResult: BootResult;
  const testDbPath = "./test-vouch.db";

  beforeEach(() => {
    // Clean up any existing test database
    cleanupDb();
    bootResult = boot({ dbPath: testDbPath });
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

  describe("GET /", () => {
    it("should return health status", async () => {
      const res = await request("/");
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body).toEqual({
        name: "vouch",
        version: "1.0.0",
        status: "ok",
      });
    });
  });

  describe("GET /v1/health", () => {
    it("should return network status", async () => {
      const res = await request("/v1/health");
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.status).toBe("ok");
      expect(body.founded).toBe(false);
      expect(body.seq).toBe(0);
    });
  });

  describe("POST /v1/found", () => {
    it("should require authentication", async () => {
      const res = await request("/v1/found", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regionId: "region-1",
          ownerEmail: "owner@example.com",
        }),
      });

      expect(res.status).toBe(401);
    });

    it("should create a new network", async () => {
      const res = await request("/v1/found", {
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

      expect(res.status).toBe(201);

      const body = await json(res);
      expect(body.ok).toBe(true);
      expect(body.seq).toBe(1);
      expect(body.idempotent).toBe(false);

      // Verify state
      const state = bootResult.getState();
      expect(state.regionId).toBe("region-1");
      expect(state.ownerId).toBe("owner-1");
    });

    it("should reject founding already founded network", async () => {
      // First found
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

      // Try to found again
      const res = await request("/v1/found", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner-2",
        },
        body: JSON.stringify({
          regionId: "region-2",
          ownerEmail: "owner2@example.com",
        }),
      });

      expect(res.status).toBe(409);
      const body = await json(res);
      expect(body.error.code).toBe("NETWORK_ALREADY_FOUNDED");
    });

    it("should support idempotency", async () => {
      const idempotencyKey = "idem-" + Date.now();

      // First request
      const res1 = await request("/v1/found", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner-1",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          regionId: "region-1",
          ownerEmail: "owner@example.com",
        }),
      });

      expect(res1.status).toBe(201);
      const body1 = await json(res1);
      expect(body1.idempotent).toBe(false);

      // Second request with same key
      const res2 = await request("/v1/found", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner-1",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          regionId: "region-1",
          ownerEmail: "owner@example.com",
        }),
      });

      expect(res2.status).toBe(200);
      const body2 = await json(res2);
      expect(body2.idempotent).toBe(true);
      expect(body2.seq).toBe(body1.seq);
    });
  });

  describe("POST /v1/admit", () => {
    beforeEach(async () => {
      // Found network first
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
    });

    it("should require owner role", async () => {
      const res = await request("/v1/admit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:random-user",
        },
        body: JSON.stringify({
          accountId: "00000000-0000-0000-0000-000000000001",
          email: "user@example.com",
          residentId: "00000000-0000-0000-0000-000000000002",
          name: "Test User",
        }),
      });

      expect(res.status).toBe(403);
    });

    it("should admit a new resident", async () => {
      const res = await request("/v1/admit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner-1",
        },
        body: JSON.stringify({
          accountId: "00000000-0000-0000-0000-000000000001",
          email: "user@example.com",
          residentId: "00000000-0000-0000-0000-000000000002",
          name: "Test User",
        }),
      });

      expect(res.status).toBe(201);

      const body = await json(res);
      expect(body.ok).toBe(true);
      expect(body.seq).toBe(2);

      // Verify state
      const state = bootResult.getState();
      expect(state.residents.size).toBe(1);
      expect(state.accounts.size).toBe(2); // owner + new user
    });
  });

  describe("POST /v1/transact", () => {
    const resident1Id = "00000000-0000-0000-0000-000000000001";
    const resident2Id = "00000000-0000-0000-0000-000000000002";
    const account1Id = "00000000-0000-0000-0000-000000000011";
    const account2Id = "00000000-0000-0000-0000-000000000012";

    beforeEach(async () => {
      // Found network
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

      // Admit two residents
      await request("/v1/admit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner-1",
        },
        body: JSON.stringify({
          accountId: account1Id,
          email: "user1@example.com",
          residentId: resident1Id,
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
          accountId: account2Id,
          email: "user2@example.com",
          residentId: resident2Id,
          name: "User 2",
        }),
      });
    });

    it("should execute a transaction", async () => {
      const res = await request("/v1/transact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer account:${account1Id}`,
        },
        body: JSON.stringify({
          fromResidentId: resident1Id,
          toResidentId: resident2Id,
          amount: "100",
          memo: "Test transaction",
        }),
      });

      expect(res.status).toBe(201);

      const body = await json(res);
      expect(body.ok).toBe(true);

      // Verify ledger
      const state = bootResult.getState();
      expect(state.ledger).toHaveLength(1);
      expect(state.ledger[0].amount).toBe("100");
    });

    it("should reject self-transaction", async () => {
      const res = await request("/v1/transact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer account:${account1Id}`,
        },
        body: JSON.stringify({
          fromResidentId: resident1Id,
          toResidentId: resident1Id,
          amount: "100",
          memo: "Self transfer",
        }),
      });

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error.code).toBe("SELF_TRANSACTION");
    });
  });

  describe("Replay on restart", () => {
    it("should restore state from journal on reboot", async () => {
      // Found network
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

      // Admit a resident
      await request("/v1/admit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner-1",
        },
        body: JSON.stringify({
          accountId: "00000000-0000-0000-0000-000000000001",
          email: "user@example.com",
          residentId: "00000000-0000-0000-0000-000000000002",
          name: "Test User",
        }),
      });

      // Shutdown
      bootResult.shutdown();

      // Reboot
      const newBootResult = boot({ dbPath: testDbPath });

      try {
        // Verify state was restored
        const state = newBootResult.getState();
        expect(state.regionId).toBe("region-1");
        expect(state.ownerId).toBe("owner-1");
        expect(state.residents.size).toBe(1);
        expect(state.seq).toBe(2);
      } finally {
        newBootResult.shutdown();
      }
    });
  });
});
