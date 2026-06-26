/**
 * Tests for documentation routes
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { boot, type BootResult } from "../../boot.js";
import { unlinkSync, existsSync } from "node:fs";

describe("Documentation Endpoints", () => {
  let bootResult: BootResult;
  const testDbPath = "./test-docs.db";

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

  async function request(path: string): Promise<Response> {
    const req = new Request(`http://localhost${path}`);
    return bootResult.app.fetch(req);
  }

  describe("GET /docs/openapi.json", () => {
    it("should return OpenAPI specification", async () => {
      const res = await request("/docs/openapi.json");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await res.json() as any;
      expect(body.openapi).toBe("3.0.3");
      expect(body.info.title).toBe("Vouch Network API");
      expect(body.paths).toBeDefined();
      expect(body.paths["/v1/found"]).toBeDefined();
      expect(body.paths["/v1/admit"]).toBeDefined();
      expect(body.paths["/v1/transact"]).toBeDefined();
    });
  });

  describe("GET /docs", () => {
    it("should return Swagger UI HTML", async () => {
      const res = await request("/docs");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");

      const body = await res.text();
      expect(body).toContain("swagger-ui");
      expect(body).toContain("/docs/openapi.json");
    });
  });

  describe("GET /docs/redoc", () => {
    it("should return ReDoc HTML", async () => {
      const res = await request("/docs/redoc");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");

      const body = await res.text();
      expect(body).toContain("redoc");
      expect(body).toContain("/docs/openapi.json");
    });
  });
});
