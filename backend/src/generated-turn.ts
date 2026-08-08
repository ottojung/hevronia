import type { PendingMemoryWrites } from "./long-term-memory/pending.js";

/**
 * The properties that this class carries are:
 * - The outcome is either silence or a successfully generated Telegram reply.
 * - Calling `postSend()` schedules its delivered user evidence for long-term
 *   memory at most once, even if the method is called repeatedly.
 *
 * The proof of those properties is guaranteed by:
 * - This class can only be introduced through these functions:
 *   - `GeneratedTurn.fromGeneratedResponse(...)`: receives text only after the
 *     LangChain invocation and reply extraction succeed.
 *   - `GeneratedTurn.fromSilence(...)`: constructs only the silence variant, so
 *     it cannot contain reply text or accidentally expose planning metadata.
 *   - Both factories memoize the single tracked post-send promise before
 *     returning it to any caller.
 */
export class GeneratedTurn {
  #postSendPromise: Promise<void> | undefined;

  private constructor(
    readonly outcome:
      | { action: "silence" }
      | { action: "reply"; replyText: string; replyToMessageId: number },
    private readonly writeMemory: () => Promise<void>,
    private readonly pendingWrites: PendingMemoryWrites,
  ) {}

  static fromGeneratedResponse(
    replyText: string,
    replyToMessageId: number,
    writeMemory: () => Promise<void>,
    pendingWrites: PendingMemoryWrites,
  ): GeneratedTurn {
    return new GeneratedTurn(
      { action: "reply", replyText, replyToMessageId },
      writeMemory,
      pendingWrites,
    );
  }

  static fromSilence(
    writeMemory: () => Promise<void>,
    pendingWrites: PendingMemoryWrites,
  ): GeneratedTurn {
    return new GeneratedTurn({ action: "silence" }, writeMemory, pendingWrites);
  }

  postSend(): Promise<void> {
    this.#postSendPromise ??= this.pendingWrites.track(this.writeMemory());
    return this.#postSendPromise;
  }
}
