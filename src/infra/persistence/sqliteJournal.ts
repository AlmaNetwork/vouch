/**
 * SQLite implementation of JournalStore
 * Append-only with WAL mode for durability
 */

import Database from "better-sqlite3";
import { chainHash, toCanonical } from "../serialization/jcs.js";
import type { JournalAppendData, JournalRecord, JournalStore } from "./journalStore.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS journal (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id      TEXT NOT NULL UNIQUE,
    idempotency_key TEXT UNIQUE,
    type            TEXT NOT NULL,
    schema_version  INTEGER NOT NULL,
    principal_json  TEXT NOT NULL,
    payload_json    TEXT NOT NULL,
    events_json     TEXT NOT NULL,
    prev_hash       TEXT,
    hash            TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_journal_idempotency ON journal(idempotency_key);

  -- Append-only enforcement triggers
  CREATE TRIGGER IF NOT EXISTS journal_no_update
  BEFORE UPDATE ON journal
  BEGIN
    SELECT RAISE(ABORT, 'append-only: updates not allowed');
  END;

  CREATE TRIGGER IF NOT EXISTS journal_no_delete
  BEFORE DELETE ON journal
  BEGIN
    SELECT RAISE(ABORT, 'append-only: deletes not allowed');
  END;
`;

export class SqliteJournalStore implements JournalStore {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private findByIdempotencyStmt: Database.Statement;
  private getLastStmt: Database.Statement;
  private countStmt: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrency and durability
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");

    // Initialize schema
    this.db.exec(SCHEMA);

    // Prepare statements
    this.insertStmt = this.db.prepare(`
      INSERT INTO journal (
        command_id, idempotency_key, type, schema_version,
        principal_json, payload_json, events_json,
        prev_hash, hash, created_at
      ) VALUES (
        @commandId, @idempotencyKey, @type, @schemaVersion,
        @principalJson, @payloadJson, @eventsJson,
        @prevHash, @hash, @createdAt
      )
    `);

    this.findByIdempotencyStmt = this.db.prepare(`
      SELECT * FROM journal WHERE idempotency_key = ?
    `);

    this.getLastStmt = this.db.prepare(`
      SELECT * FROM journal ORDER BY seq DESC LIMIT 1
    `);

    this.countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM journal
    `);
  }

  append(data: JournalAppendData): JournalRecord {
    const now = new Date().toISOString();
    const principalJson = toCanonical(data.principal);
    const payloadJson = toCanonical(data.payload);
    const eventsJson = toCanonical(data.events);

    // Compute hash chain
    const recordForHash = {
      commandId: data.commandId,
      idempotencyKey: data.idempotencyKey,
      type: data.type,
      schemaVersion: data.schemaVersion,
      principalJson,
      payloadJson,
      eventsJson,
      createdAt: now,
    };

    const hash = chainHash(recordForHash, data.prevHash);

    const params = {
      commandId: data.commandId,
      idempotencyKey: data.idempotencyKey,
      type: data.type,
      schemaVersion: data.schemaVersion,
      principalJson,
      payloadJson,
      eventsJson,
      prevHash: data.prevHash,
      hash,
      createdAt: now,
    };

    const result = this.insertStmt.run(params);
    const seq = Number(result.lastInsertRowid);

    return {
      seq,
      commandId: data.commandId,
      idempotencyKey: data.idempotencyKey,
      type: data.type,
      schemaVersion: data.schemaVersion,
      principalJson,
      payloadJson,
      eventsJson,
      prevHash: data.prevHash,
      hash,
      createdAt: now,
    };
  }

  findByIdempotencyKey(key: string): JournalRecord | null {
    const row = this.findByIdempotencyStmt.get(key) as DbRow | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  *readFrom(fromSeq: number): Generator<JournalRecord> {
    const stmt = this.db.prepare(`
      SELECT * FROM journal WHERE seq >= ? ORDER BY seq ASC
    `);

    for (const row of stmt.iterate(fromSeq) as Iterable<DbRow>) {
      yield this.rowToRecord(row);
    }
  }

  getLastRecord(): JournalRecord | null {
    const row = this.getLastStmt.get() as DbRow | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  count(): number {
    const result = this.countStmt.get() as { count: number };
    return result.count;
  }

  close(): void {
    this.db.close();
  }

  private rowToRecord(row: DbRow): JournalRecord {
    return {
      seq: row.seq,
      commandId: row.command_id,
      idempotencyKey: row.idempotency_key,
      type: row.type,
      schemaVersion: row.schema_version,
      principalJson: row.principal_json,
      payloadJson: row.payload_json,
      eventsJson: row.events_json,
      prevHash: row.prev_hash,
      hash: row.hash,
      createdAt: row.created_at,
    };
  }
}

interface DbRow {
  seq: number;
  command_id: string;
  idempotency_key: string | null;
  type: string;
  schema_version: number;
  principal_json: string;
  payload_json: string;
  events_json: string;
  prev_hash: string | null;
  hash: string;
  created_at: string;
}
