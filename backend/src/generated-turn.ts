import type { PendingMemoryWrites } from "./long-term-memory/pending.js";

export type GeneratedTurnOutcome =
  | {
      action: "silence";
      completeObservation(): Promise<void>;
    }
  | {
      action: "reply";
      replyText: string;
      replyToMessageId: number;
      completeDelivery(deliveredMessageId: number): Promise<void>;
    };

/**
 * The properties that this class carries are:
 * - Silence cannot contain reply text or delivery behavior.
 * - A reply is persisted only through `completeDelivery(...)`, after Telegram
 *   supplies the delivered outgoing message identifier.
 *
 * The proof of those properties is guaranteed by:
 * - This class can only be introduced through these functions:
 *   - `GeneratedTurn.fromSilence(...)`: constructs only `completeObservation`.
 *   - `GeneratedTurn.fromReply(...)`: constructs only `completeDelivery` and
 *     memoizes its post-delivery persistence operation.
 */
export class GeneratedTurn {
  private constructor(readonly outcome: GeneratedTurnOutcome) {}

  static fromSilence(
    afterObservation: () => Promise<void>,
    pendingWrites: PendingMemoryWrites,
  ): GeneratedTurn {
    let completion: Promise<void> | undefined;
    return new GeneratedTurn({
      action: "silence",
      completeObservation: () => {
        completion ??= pendingWrites.track(afterObservation());
        return completion;
      },
    });
  }

  static fromReply(
    replyText: string,
    replyToMessageId: number,
    afterDelivery: (deliveredMessageId: number) => Promise<void>,
    pendingWrites: PendingMemoryWrites,
  ): GeneratedTurn {
    let completion: Promise<void> | undefined;
    return new GeneratedTurn({
      action: "reply",
      replyText,
      replyToMessageId,
      completeDelivery: (deliveredMessageId) => {
        completion ??= pendingWrites.track(afterDelivery(deliveredMessageId));
        return completion;
      },
    });
  }
}
