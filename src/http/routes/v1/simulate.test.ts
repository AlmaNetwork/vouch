/**
 * Tests for simulate endpoint
 */

import { existsSync, unlinkSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BootResult, boot } from "../../../boot.js";

describe("POST /v1/simulate", () => {
  let bootResult: BootResult;
  const testDbPath = "./test-simulate.db";

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

  async function request(path: string, options: RequestInit = {}): Promise<Response> {
    const req = new Request(`http://localhost${path}`, options);
    return bootResult.app.fetch(req);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function json(res: Response): Promise<any> {
    return res.json();
  }

  describe("valid simulation", () => {
    it("should simulate establish command without persisting", async () => {
      const res = await request("/v1/simulate", {
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
      expect(body.valid).toBe(true);
      expect(body.eventCount).toBe(2); // RegionEstablished + AccountCreated

      // Verify state was NOT changed
      const stateRes = await request("/v1/health");
      const stateBody = await json(stateRes);
      expect(stateBody.founded).toBe(false); // Should still be false
    });
  });

  describe("invalid simulation", () => {
    it("should return 412 for invalid commands", async () => {
      // First establish the region using the legacy /v1/found endpoint
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

      // Try to simulate establishing again (should fail)
      const res = await request("/v1/simulate", {
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

      expect(res.status).toBe(412);
      const body = await json(res);
      expect(body.ok).toBe(false);
      expect(body.valid).toBe(false);
      expect(body.error.code).toBe("NETWORK_ALREADY_FOUNDED");
    });
  });

  describe("validation", () => {
    it("should reject empty commands array", async () => {
      const res = await request("/v1/simulate", {
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

    it("should require authentication", async () => {
      const res = await request("/v1/simulate", {
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
