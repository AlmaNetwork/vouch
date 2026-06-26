/**
 * Replay functionality for restore-on-boot
 * Reconstructs state from journal records
 */

import type { JournalStore, JournalRecord } from "./journalStore.js";
import { chainHash } from "../serialization/jcs.js";
import {
  createInitialState,
  type NetworkState,
} from "../../domain/models/types.js";
import { applyEvents, type DomainEvent } from "../../domain/projector.js";

export interface ReplayResult {
  state: NetworkState;
  lastSeq: number;
  lastHash: string | null;
  recordCount: number;
}

/**
 * Replay all journal records to reconstruct state
 * Verifies hash chain integrity during replay
 */
export function replay(journal: JournalStore): ReplayResult {
  let state = createInitialState();
  let prevHash: string | null = null;
  let lastSeq = 0;
  let recordCount = 0;

  for (const record of journal.readFrom(1)) {
    // Verify hash chain integrity
    verifyHashIntegrity(record, prevHash);

    // Parse and apply events
    const events = JSON.parse(record.eventsJson) as DomainEvent[];
    state = applyEvents(state, events);

    // Update tracking
    state = {
      ...state,
      seq: record.seq,
      lastHash: record.hash,
    };

    prevHash = record.hash;
    lastSeq = record.seq;
    recordCount++;
  }

  return {
    state,
    lastSeq,
    lastHash: prevHash,
    recordCount,
  };
}

/**
 * Verify hash chain integrity for a single record
 * @throws Error if hash verification fails
 */
function verifyHashIntegrity(
  record: JournalRecord,
  expectedPrevHash: string | null
): void {
  // Verify prev_hash chain
  if (record.prevHash !== expectedPrevHash) {
    throw new Error(
      `Hash chain broken at seq ${record.seq}: ` +
        `expected prevHash ${expectedPrevHash}, got ${record.prevHash}`
    );
  }

  // Recompute hash to verify integrity
  const recordForHash = {
    commandId: record.commandId,
    idempotencyKey: record.idempotencyKey,
    type: record.type,
    schemaVersion: record.schemaVersion,
    principalJson: record.principalJson,
    payloadJson: record.payloadJson,
    eventsJson: record.eventsJson,
    createdAt: record.createdAt,
  };

  const computedHash = chainHash(recordForHash, record.prevHash);

  if (computedHash !== record.hash) {
    throw new Error(
      `Hash verification failed at seq ${record.seq}: ` +
        `expected ${record.hash}, computed ${computedHash}`
    );
  }
}
