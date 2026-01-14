/**
 * ABOUTME: NamePool class for managing sequential worker names.
 * Provides worker names (worker1, worker2, ...) with ID recycling for reuse.
 */

/**
 * Pool for managing sequential worker names with recycling.
 * Names follow the pattern: worker1, worker2, worker3, etc.
 * Released names are recycled in sorted order for predictable reuse.
 */
export class NamePool {
  private nextId: number = 1;
  private released: number[] = [];

  /**
   * Acquire the next available worker name.
   * Prefers recycled IDs (sorted lowest first), otherwise allocates new.
   *
   * @returns Worker name (e.g., "worker1", "worker2")
   */
  acquire(): string {
    if (this.released.length > 0) {
      const id = this.released.shift()!;
      return `worker${id}`;
    }
    return `worker${this.nextId++}`;
  }

  /**
   * Release a worker name back to the pool for reuse.
   * Invalid names are silently ignored.
   *
   * @param name - Worker name to release (e.g., "worker1")
   */
  release(name: string): void {
    const match = name.match(/^worker(\d+)$/);
    if (match) {
      const id = parseInt(match[1], 10);
      // Avoid duplicates
      if (!this.released.includes(id)) {
        this.released.push(id);
        this.released.sort((a, b) => a - b);
      }
    }
  }

  /**
   * Reconcile the pool with existing worktree names on startup.
   * Sets nextId to one past the highest used ID and clears released pool.
   *
   * @param inUse - Array of worker names currently in use
   */
  reconcile(inUse: string[]): void {
    const usedIds = inUse
      .map((n) => n.match(/^worker(\d+)$/))
      .filter(Boolean)
      .map((m) => parseInt(m![1], 10));

    this.nextId = usedIds.length > 0 ? Math.max(...usedIds) + 1 : 1;
    this.released = [];
  }

  /**
   * Get the current state for debugging/testing.
   *
   * @returns Object with nextId and released array
   */
  getState(): { nextId: number; released: number[] } {
    return {
      nextId: this.nextId,
      released: [...this.released],
    };
  }
}
