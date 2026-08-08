const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

export class PendingMemoryWrites {
  readonly #pending = new Set<Promise<void>>();

  track(task: Promise<void>): Promise<void> {
    this.#pending.add(task);
    void task.then(
      () => this.#pending.delete(task),
      () => this.#pending.delete(task),
    );
    return task;
  }

  async drain(timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS): Promise<void> {
    if (this.#pending.size === 0) {
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timeout = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const outcome = await Promise.race([
      Promise.allSettled([...this.#pending]).then(() => "drained"),
      deadline,
    ]);
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (outcome === "timeout") {
      console.warn(`Timed out draining ${this.#pending.size} long-term-memory writes`);
    }
  }
}
