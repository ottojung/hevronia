import type { GeneratedTurn } from "./generated-turn.js";
import type { DeliveredHevroniaMessage, ReplyRelationship, TelegramSenderIdentity } from "./telegram-event.js";

export interface TelegramTurnDelivery {
  showTyping(): Promise<void>;
  reply(text: string, replyToMessageId: number | null): Promise<number>;
}

export type TelegramDeliveryResult =
  | { status: "silence" }
  | { status: "delivered"; persistence: "queued" };

/**
 * The delivery commit boundary: `begin()` marks the instant the Telegram send
 * is committed (a later incoming event can no longer discard its outcome), and
 * `complete()` reconciles the result so a waiting replacement reaction can
 * proceed.
 */
export interface DeliveryCommit {
  begin(): void;
  complete(): void;
}

export interface FallbackDeliveryInput {
  text: string;
  sender: TelegramSenderIdentity;
  chatKind: "private" | "group" | "supergroup";
  messageThreadId: number | null;
  replyTo: ReplyRelationship;
}

/**
 * Delivers a generated turn. The optional `guard` runs before typing, after
 * typing, and immediately before the Telegram send, so a stale or cancelled
 * reaction can never begin sending an obsolete reply. Once the send is
 * committed (`commit?.begin()`), the confirmed outgoing event is persisted
 * regardless of any later revision, and the result is reconciled through
 * `commit?.complete()`.
 */
export async function deliverGeneratedTurn(
  turn: GeneratedTurn,
  delivery: TelegramTurnDelivery,
  guard: () => void = () => undefined,
  commit?: DeliveryCommit,
): Promise<TelegramDeliveryResult> {
  if (turn.outcome.action === "silence" || turn.outcome.action === "ended") {
    return { status: "silence" };
  }
  const speak = turn.outcome;
  guard();
  await delivery.showTyping();
  guard();
  commit?.begin();
  let deliveredMessageId: number;
  try {
    deliveredMessageId = await delivery.reply(
      speak.replyText,
      speak.replyTo?.targetMessageId ?? null,
    );
  } catch (error) {
    commit?.complete();
    throw error;
  }
  speak.persistDelivery(deliveredMessageId);
  commit?.complete();
  return { status: "delivered", persistence: "queued" };
}

/**
 * Delivers the fallback message. The optional `guard` runs immediately before
 * the send so a stale or cancelled reaction never sends fallback; once the
 * send is confirmed, the fallback is persisted canonically.
 */
export async function deliverFallbackMessage(
  input: FallbackDeliveryInput,
  delivery: TelegramTurnDelivery,
  persist: (message: DeliveredHevroniaMessage) => void,
  guard: () => void = () => undefined,
): Promise<TelegramDeliveryResult> {
  guard();
  const deliveredMessageId = await delivery.reply(input.text, input.replyTo.targetMessageId);
  persist({
    kind: "hevronia", messageId: deliveredMessageId, sender: input.sender,
    senderDisplayName: "Хевронія", senderUsername: null, chatKind: input.chatKind,
    text: input.text, messageThreadId: input.messageThreadId, replyTo: input.replyTo,
  });
  return { status: "delivered", persistence: "queued" };
}
