/**
 * Journal Store interface
 * Append-only log for command packets
 */

import type { Principal } from "../../domain/models/types.js";
import type { DomainEvent } from "../../domain/projector.js";

/** Journal record stored in the append-only log */
export interface JournalRecord {
  seq: number;
  commandId: string;
  idempotencyKey: string | null;
  type: string;
  schemaVersion: number;
  principalJson: string;
  payloadJson: string;
  eventsJson: string;
  prevHash: string | null;
  hash: string;
  createdAt: string;
}

/** Data to append (without seq and hash which are computed) */
export interface JournalAppendData {
  commandId: string;
  idempotencyKey: string | null;
  type: string;
  schemaVersion: number;
  principal: Principal;
  payload: unknown;
  events: DomainEvent[];
  prevHash: string | null;
}

/** Journal Store interface for dependency injection */
export interface JournalStore {
  /** Append a new record to the journal */
  append(data: JournalAppendData): JournalRecord;

  /** Find record by idempotency key */
  findByIdempotencyKey(key: string): JournalRecord | null;

  /** Read records starting from a sequence number */
  readFrom(fromSeq: number): Iterable<JournalRecord>;

  /** Get the last record (for hash chain) */
  getLastRecord(): JournalRecord | null;

  /** Get total count of records */
  count(): number;

  /** Close the store */
  close(): void;
}
