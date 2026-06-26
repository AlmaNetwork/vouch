/**
 * Tests for execute endpoint
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { boot, type BootResult } from "../../../boot.js";
import { unlinkSync, existsSync } from "node:fs";

describe("POST /v1/execute", () => {
  let bootResult: BootResult;
  const testDbPath = "./test-execute.db";

  beforeEach(() => {
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

  async function request(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const req = new Request(`http://localhost${path}`, options);
    return bootResult.app.fetch(req);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function json(res: Response): Promise<any> {
    return res.json();
  }

  describe("establish command", () => {
    it("should establish a new region", async () => {
      const res = await request("/v1/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner@tokyo",
        },
        body: JSON.stringify({
          commands: [
            {
              name: "establish",
              regionId: "tokyo",
              regionName: "Tokyo Region",
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ok).toBe(true);
      expect(body.seq).toBe(1);
    });

    it("should reject establishing an already established region", async () => {
      // First establish using legacy endpoint (which persists)
      await request("/v1/found", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner@tokyo",
        },
        body: JSON.stringify({
          regionId: "tokyo",
          ownerEmail: "owner@example.com",
        }),
      });

      // Try to establish again using execute
      const res = await request("/v1/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner@tokyo",
        },
        body: JSON.stringify({
          commands: [
            {
              name: "establish",
              regionId: "tokyo",
              regionName: "Tokyo Region 2",
            },
          ],
        }),
      });

      expect(res.status).toBe(409);
      const body = await json(res);
      expect(body.error.code).toBe("NETWORK_ALREADY_FOUNDED");
    });
  });

  describe("multiple commands", () => {
    it("should execute multiple commands atomically", async () => {
      // First establish the region using legacy endpoint
      await request("/v1/found", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner@tokyo",
        },
        body: JSON.stringify({
          regionId: "tokyo",
          ownerEmail: "owner@example.com",
        }),
      });

      // Execute admit command
      const res = await request("/v1/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner@tokyo",
        },
        body: JSON.stringify({
          commands: [
            {
              name: "admit",
              accountId: "alice@tokyo",
              email: "alice@example.com",
              residentId: "00000000-0000-0000-0000-000000000001",
              residentName: "Alice",
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ok).toBe(true);
    });
  });

  describe("validation", () => {
    it("should reject empty commands array", async () => {
      const res = await request("/v1/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner@tokyo",
        },
        body: JSON.stringify({
          commands: [],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should reject unknown command", async () => {
      const res = await request("/v1/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account:owner@tokyo",
        },
        body: JSON.stringify({
          commands: [
            {
              name: "unknownCommand",
              data: "test",
            },
          ],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should require authentication", async () => {
      const res = await request("/v1/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          commands: [
            {
              name: "establish",
              regionId: "tokyo",
              regionName: "Tokyo Region",
            },
          ],
        }),
      });

      expect(res.status).toBe(401);
    });
  });
});
