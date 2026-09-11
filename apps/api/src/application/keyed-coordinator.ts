/**
 * Small in-process coordinator keyed by an authoritative scope.
 *
 * It deliberately has no global queue: unrelated organizations can make
 * progress independently, and callers can choose the smallest key that owns
 * the invariant (normally an organization or a command idempotency lookup).
 * The coordinator is only for short local critical sections.  Callers must
 * perform remote/provider work before entering the section, or use a
 * persistence CAS/lease at that boundary.
 */
export class KeyedAsyncCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    const normalized = key.trim();
    if (!normalized) throw new Error("coordination key is required");
    const predecessor = this.tails.get(normalized) ?? Promise.resolve();
    let releaseTail!: () => void;
    const tail = new Promise<void>((resolve) => { releaseTail = resolve; });
    this.tails.set(normalized, tail);
    await predecessor;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseTail();
      if (this.tails.get(normalized) === tail) this.tails.delete(normalized);
    };
  }

  async run<T>(key: string, work: () => T | Promise<T>): Promise<T> {
    const release = await this.acquire(key);
    try {
      return await work();
    } finally {
      release();
    }
  }

  get size(): number {
    return this.tails.size;
  }
}
