import { sleep } from "./retry.js";
import type { ConversationThreadId } from "./identifiers.js";

/**
 * The properties that this class carries are:
 * - confirmed outgoing events are serialized per conversation thread;
 * - a later turn can wait until all earlier confirmed events have persisted;
 * - transient write failures remain pending and retry instead of being dropped.
 *
 * The proof of those properties is guaranteed by:
 * - This class can only receive writes through `enqueue(...)`, which chains a
 *   retrying task after the thread's prior task and removes it only on success.
 * - `waitForThread(...)` awaits that same per-thread chain.
 * - `drain()` awaits every live per-thread chain before shutdown completes.
 */
export class PendingConversationWrites {
  readonly #pending = new Map<string, Promise<void>>();

  enqueue(threadId: ConversationThreadId, write: () => Promise<void>): void {
    const key = threadId.toPersistenceKey();
    const previous = this.#pending.get(key) ?? Promise.resolve();
    const pending = previous.then(() => retry(write));
    this.#pending.set(key, pending);
    void pending.finally(() => {
      if (this.#pending.get(key) === pending) this.#pending.delete(key);
    });
  }

  async waitForThread(threadId: ConversationThreadId): Promise<void> {
    await this.#pending.get(threadId.toPersistenceKey());
  }

  async drain(): Promise<void> {
    await Promise.all(this.#pending.values());
  }
}

async function retry(write: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await write();
      return;
    } catch (error) {
      const delayMs = Math.min(100 * attempt, 1_000);
      console.warn(`Canonical conversation persistence failed; retrying in ${delayMs}ms: ${String(error)}`);
      await sleep(delayMs);
    }
  }
}
