/**
 * Command Bus - dispatches commands through single writer
 * Handles idempotency, journaling, and state updates
 */

import { SingleWriter } from "./singleWriter.js";
import type { CommandPacket } from "./commandPacket.js";
import { handle } from "./handlers/index.js";
import { applyEvents } from "../domain/projector.js";
import type { NetworkState } from "../domain/models/types.js";
import type { JournalStore } from "../infra/persistence/journalStore.js";

export interface DispatchResult {
  ok: true;
  seq: number;
  idempotent: boolean;
  schemaVersion: number;
}

export interface StateRef {
  get(): NetworkState;
  set(state: NetworkState): void;
}

export class CommandBus {
  private writer = new SingleWriter();
  private lastHash: string | null = null;

  constructor(
    private journal: JournalStore,
    private stateRef: StateRef,
    initialLastHash: string | null = null
  ) {
    this.lastHash = initialLastHash;
  }

  /**
   * Dispatch a command through the single writer
   * Returns the sequence number of the committed record
   */
  async dispatch(command: CommandPacket): Promise<DispatchResult> {
    return this.writer.enqueue(async () => {
      // Check idempotency
      if (command.idempotencyKey) {
        const existing = this.journal.findByIdempotencyKey(
          command.idempotencyKey
        );
        if (existing) {
          return { ok: true, seq: existing.seq, idempotent: true, schemaVersion: existing.schemaVersion };
        }
      }

      // Get current state
      const state = this.stateRef.get();

      // Handle command (produces events)
      const events = handle(state, command);

      // Append to journal
      const record = this.journal.append({
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        type: command.type,
        schemaVersion: command.schemaVersion,
        principal: command.principal,
        payload: command.payload,
        events,
        prevHash: this.lastHash,
      });

      // Apply events to state
      let newState = applyEvents(state, events);
      newState = {
        ...newState,
        seq: record.seq,
        lastHash: record.hash,
      };
      this.stateRef.set(newState);

      // Update hash chain
      this.lastHash = record.hash;

      return { ok: true, seq: record.seq, idempotent: false, schemaVersion: command.schemaVersion };
    });
  }

  /**
   * Get current last hash for chain verification
   */
  getLastHash(): string | null {
    return this.lastHash;
  }
}
