/**
 * Tests for found handler
 */

import { describe, it, expect } from "vitest";
import { handleFound } from "./foundHandler.js";
import { createInitialState, type AccountId, type RegionId } from "../../domain/models/types.js";
import type { FoundCommand } from "../commandPacket.js";

describe("handleFound", () => {
  const createFoundCommand = (
    overrides: Partial<FoundCommand> = {}
  ): FoundCommand => ({
    commandId: "cmd-1",
    idempotencyKey: null,
    type: "found",
    schemaVersion: 1,
    principal: { accountId: "owner-1" as AccountId, roles: [] },
    payload: {
      regionId: "region-1",
      ownerEmail: "owner@example.com",
    },
    meta: {
      requestId: "req-1",
      receivedAt: "2024-01-01T00:00:00.000Z",
    },
    ...overrides,
  });

  it("should create NetworkFounded event for new network", () => {
    const state = createInitialState();
    const command = createFoundCommand();

    const events = handleFound(state, command);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "NetworkFounded",
      regionId: "region-1",
      ownerId: "owner-1",
      ownerEmail: "owner@example.com",
      timestamp: "2024-01-01T00:00:00.000Z",
    });
  });

  it("should throw error if network already founded", () => {
    const state = {
      ...createInitialState(),
      regionId: "existing-region" as RegionId,
    };
    const command = createFoundCommand();

    expect(() => handleFound(state, command)).toThrow(
      "Network has already been founded"
    );
  });
});
