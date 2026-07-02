/**
 * Brain Scheduler
 * Converts time-based events into commands for deterministic replay
 *
 * Design principle: scheduler doesn't touch state directly,
 * it only dispatches tick commands through the command bus.
 */

import type { CommandBus } from "../application/commandBus.js";
import { createCommand, type TickCommand } from "../application/commandPacket.js";
import { SYSTEM_PRINCIPAL } from "../domain/models/types.js";

export interface SchedulerOptions {
  /** Tick interval in milliseconds */
  tickIntervalMs: number;
  /** Whether to start immediately */
  autoStart?: boolean;
}

export class Scheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private commandBus: CommandBus,
    private options: SchedulerOptions,
  ) {
    if (options.autoStart) {
      this.start();
    }
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) {
      console.log("[scheduler] Already running");
      return;
    }

    this.running = true;
    console.log(`[scheduler] Starting with interval ${this.options.tickIntervalMs}ms`);

    this.intervalId = setInterval(() => {
      this.tick("scheduled");
    }, this.options.tickIntervalMs);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) {
      console.log("[scheduler] Not running");
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.running = false;
    console.log("[scheduler] Stopped");
  }

  /**
   * Check if scheduler is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Emit a tick command
   * This is the only way the scheduler affects state
   */
  private async tick(reason: string): Promise<void> {
    const now = new Date().toISOString();

    const command: TickCommand = createCommand(
      "tick",
      {
        tickAt: now,
        reason,
      },
      SYSTEM_PRINCIPAL,
      {
        requestId: `tick-${Date.now()}`,
        receivedAt: now,
      },
    );

    try {
      const result = await this.commandBus.dispatch(command);
      console.log(`[scheduler] Tick dispatched: seq=${result.seq}`);
    } catch (error) {
      console.error("[scheduler] Tick failed:", error);
    }
  }

  /**
   * Manually trigger a tick (for testing)
   */
  async manualTick(reason: string = "manual"): Promise<void> {
    await this.tick(reason);
  }
}

/**
 * Create a scheduler with default options
 */
export function createScheduler(commandBus: CommandBus, options: Partial<SchedulerOptions> = {}): Scheduler {
  return new Scheduler(commandBus, {
    tickIntervalMs: options.tickIntervalMs ?? 60000, // 1 minute default
    autoStart: options.autoStart ?? false,
  });
}
