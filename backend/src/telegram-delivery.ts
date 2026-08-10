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

export async function deliverGeneratedTurn(
  turn: GeneratedTurn,
  delivery: TelegramTurnDelivery,
): Promise<TelegramDeliveryResult> {
  if (turn.outcome.action === "silence") {
    return { status: "silence" };
  }
  const speak = turn.outcome;
  await delivery.showTyping();
  const deliveredMessageId = await delivery.reply(
    speak.replyText,
    speak.replyTo?.targetMessageId ?? null,
  );
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
    senderDisplayName: "Хевронія", chatKind: input.chatKind, text: input.text,
    messageThreadId: input.messageThreadId, replyTo: input.replyTo,
  });
  return { status: "delivered", persistence: "queued" };
}
