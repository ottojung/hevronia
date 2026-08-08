import type { ReplyRelationship } from "./telegram-event.js";

export type GeneratedTurnOutcome =
  | { action: "silence" }
  | {
      action: "reply";
      replyText: string;
      replyTo: ReplyRelationship;
      persistDelivery(deliveredMessageId: number): void;
    };

/**
 * The properties that this class carries are:
 * - Silence cannot contain reply text or delivery behavior.
 * - A reply exposes one consistency operation that persists only a
 *   Telegram-confirmed outgoing event.
 *
 * The proof of those properties is guaranteed by:
 * - This class can only be introduced through these functions:
 *   - `GeneratedTurn.fromSilence()`: constructs only the silence variant.
 *   - `GeneratedTurn.fromReply(...)`: requires post-delivery persistence and
 *     memoizes it after Telegram supplies the delivered message identifier.
 */
export class GeneratedTurn {
  private constructor(readonly outcome: GeneratedTurnOutcome) {}

  static fromSilence(): GeneratedTurn {
    return new GeneratedTurn({ action: "silence" });
  }

  static fromReply(
    replyText: string,
    replyTo: ReplyRelationship,
    persistDelivery: (deliveredMessageId: number) => void,
  ): GeneratedTurn {
    let persisted = false;
    return new GeneratedTurn({
      action: "reply",
      replyText,
      replyTo,
      persistDelivery: (deliveredMessageId) => {
        if (persisted) return;
        persisted = true;
        persistDelivery(deliveredMessageId);
      },
    });
  }
}
