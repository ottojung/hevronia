import { sleep } from "./retry.js";
import type { ConversationThreadId } from "./identifiers.js";

export class TerminalConversationWriteError extends Error {
  constructor(message: string) {
    super(message); this.name = "TerminalConversationWriteError";
  }
}

export class ConversationThreadPersistenceError extends Error {
  constructor(readonly threadKey: string, readonly failure: unknown) {
    super(`Canonical conversation persistence failed terminally for ${threadKey}`);
    this.name = "ConversationThreadPersistenceError";
  }
}

export function isConversationThreadPersistenceError(
  error: unknown,
): error is ConversationThreadPersistenceError {
  return error instanceof ConversationThreadPersistenceError;
}

type ThreadWriteState =
  | { status: "pending"; completion: Promise<void> }
  | { status: "failed"; error: ConversationThreadPersistenceError };

/**
 * The properties that this class carries are:
 * - canonical events are serialized per conversation thread;
 * - transient failures retry a bounded number of times;
 * - terminal failures remain explicit and make later operations reject;
 * - shutdown waits only for bounded pending attempts, never immortal retries.
 *
 * The proof of those properties is guaranteed by:
 * - `enqueue(...)` chains after the existing pending completion for the thread.
 * - `attempt(...)` returns after success, a terminal marker, or retry exhaustion.
 * - terminal results replace pending state with a retained failed variant.
 * - `waitForThread(...)` throws the retained thread-specific failure.
 */
export class PendingConversationWrites {
  readonly #states = new Map<string, ThreadWriteState>();

  constructor(
    private readonly maxAttempts = 5,
    private readonly retryDelayMs = 100,
  ) {}

  enqueue(threadId: ConversationThreadId, write: () => Promise<void>): void {
    const key = threadId.toPersistenceKey();
    const state = this.#states.get(key);
    if (state?.status === "failed") return;
    const previous = state?.completion ?? Promise.resolve();
    const completion = previous.then(async () => {
      if (this.#states.get(key)?.status === "failed") return;
      const failure = await attempt(write, this.maxAttempts, this.retryDelayMs);
      if (failure !== undefined) {
        this.#states.set(key, { status: "failed",
          error: new ConversationThreadPersistenceError(key, failure) });
      }
    });
    this.#states.set(key, { status: "pending", completion });
    void completion.then(() => {
      const current = this.#states.get(key);
      if (current?.status === "pending" && current.completion === completion) {
        this.#states.delete(key);
      }
    });
  }

  async submitAndWait(threadId: ConversationThreadId, write: () => Promise<void>): Promise<void> {
    this.enqueue(threadId, write);
    await this.waitForThread(threadId);
  }

  async waitForThread(threadId: ConversationThreadId): Promise<void> {
    const key = threadId.toPersistenceKey();
    const state = this.#states.get(key);
    if (state?.status === "pending") await state.completion;
    const settled = this.#states.get(key);
    if (settled?.status === "failed") throw settled.error;
  }

  async drain(): Promise<void> {
    const pending = [...this.#states.values()].flatMap((state) =>
      state.status === "pending" ? [state.completion] : []);
    await Promise.all(pending);
  }
}

async function attempt(
  write: () => Promise<void>,
  maxAttempts: number,
  retryDelayMs: number,
): Promise<unknown | undefined> {
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    try {
      await write();
      return undefined;
    } catch (error) {
      if (error instanceof TerminalConversationWriteError || attemptNumber === maxAttempts) {
        return error;
      }
      const delayMs = Math.min(retryDelayMs * attemptNumber, 1_000);
      console.warn(`Canonical conversation persistence failed; retrying in ${delayMs}ms: ${String(error)}`);
      await sleep(delayMs);
    }
  }
  return new TerminalConversationWriteError("Canonical write exhausted without a result");
}
