import type { PendingMemoryWrites } from "./long-term-memory/pending.js";

/**
 * The properties that this class carries are:
 * - `replyText` is a successfully generated assistant response.
 * - Calling `postSend()` schedules its completed turn for long-term memory at
 *   most once, even if the method is called repeatedly.
 *
 * The proof of those properties is guaranteed by:
 * - This class can only be introduced through these functions:
 *   - `GeneratedTurn.fromGeneratedResponse(...)`: receives text only after the
 *     LangChain invocation and reply extraction succeed, and memoizes the
 *     single tracked post-send promise before returning it to any caller.
 */
export class GeneratedTurn {
  #postSendPromise: Promise<void> | undefined;

  private constructor(
    readonly replyText: string,
    private readonly writeMemory: () => Promise<void>,
    private readonly pendingWrites: PendingMemoryWrites,
  ) {}

  static fromGeneratedResponse(
    replyText: string,
    writeMemory: () => Promise<void>,
    pendingWrites: PendingMemoryWrites,
  ): GeneratedTurn {
    return new GeneratedTurn(replyText, writeMemory, pendingWrites);
  }

  postSend(): Promise<void> {
    this.#postSendPromise ??= this.pendingWrites.track(this.writeMemory());
    return this.#postSendPromise;
  }
}
