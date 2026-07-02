/**
 * Single Writer - serializes all state mutations
 * Ensures deterministic sequence and consistency
 */

export class SingleWriter {
  private chain: Promise<unknown> = Promise.resolve();

  /**
   * Enqueue a function to be executed serially
   * All state mutations must go through this
   */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    // Keep chain going regardless of success/failure
    this.chain = next.then(
      () => {},
      () => {},
    );
    return next;
  }
}
