import type { GeneratedTurn } from "./generated-turn.js";
import type { DeliveredHevroniaMessage, ReplyRelationship, TelegramSenderIdentity } from "./telegram-event.js";

export interface TelegramTurnDelivery {
  showTyping(): Promise<void>;
  reply(text: string, replyToMessageId: number | null): Promise<number>;
}

export type TelegramDeliveryResult =
  | { status: "silence" }
  | { status: "delivered"; persistence: "queued" };

export interface FallbackDeliveryInput {
  text: string;
  sender: TelegramSenderIdentity;
  chatKind: "private" | "group" | "supergroup";
  messageThreadId: number | null;
  replyTo: ReplyRelationship;
}

/**
 * Delivers a generated turn. The optional `guard` runs before typing, after
 * typing, immediately before the Telegram send, and before scheduling the
 * canonical outgoing event, so a stale or cancelled reaction can never send or
 * persist an obsolete reply.
 */
export async function deliverGeneratedTurn(
  turn: GeneratedTurn,
  delivery: TelegramTurnDelivery,
  guard: () => void = () => undefined,
): Promise<TelegramDeliveryResult> {
  if (turn.outcome.action === "silence" || turn.outcome.action === "ended") {
    return { status: "silence" };
  }
  const speak = turn.outcome;
  guard();
  await delivery.showTyping();
  guard();
  const deliveredMessageId = await delivery.reply(
    speak.replyText,
    speak.replyTo?.targetMessageId ?? null,
  );
  guard();
  speak.persistDelivery(deliveredMessageId);
  return { status: "delivered", persistence: "queued" };
}

export async function deliverFallbackMessage(
  input: FallbackDeliveryInput,
  delivery: TelegramTurnDelivery,
  persist: (message: DeliveredHevroniaMessage) => void,
): Promise<TelegramDeliveryResult> {
  const deliveredMessageId = await delivery.reply(input.text, input.replyTo.targetMessageId);
  persist({
    kind: "hevronia", messageId: deliveredMessageId, sender: input.sender,
    senderDisplayName: "Хевронія", senderUsername: null, chatKind: input.chatKind,
    text: input.text, messageThreadId: input.messageThreadId, replyTo: input.replyTo,
  });
  return { status: "delivered", persistence: "queued" };
}
