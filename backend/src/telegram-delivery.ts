import type { GeneratedTurn } from "./generated-turn.js";
import type { DeliveredHevroniaMessage, ReplyRelationship } from "./telegram-event.js";

export interface TelegramTurnDelivery {
  showTyping(): Promise<void>;
  reply(text: string, replyToMessageId: number): Promise<number>;
}

export type TelegramDeliveryResult =
  | { status: "silence" }
  | { status: "delivered"; persistence: "stored" | "failed" };

export interface FallbackDeliveryInput {
  text: string;
  senderId: number;
  chatKind: "private" | "group" | "supergroup";
  replyTo: ReplyRelationship;
}

export async function deliverGeneratedTurn(
  turn: GeneratedTurn,
  delivery: TelegramTurnDelivery,
): Promise<TelegramDeliveryResult> {
  if (turn.outcome.action === "silence") {
    return { status: "silence" };
  }
  const reply = turn.outcome;
  await delivery.showTyping();
  const deliveredMessageId = await delivery.reply(
    reply.replyText,
    reply.replyTo.targetMessageId,
  );
  return persistConfirmed(() => reply.persistDelivery(deliveredMessageId));
}

export async function deliverFallbackMessage(
  input: FallbackDeliveryInput,
  delivery: TelegramTurnDelivery,
  persist: (message: DeliveredHevroniaMessage) => Promise<void>,
): Promise<TelegramDeliveryResult> {
  const deliveredMessageId = await delivery.reply(input.text, input.replyTo.targetMessageId);
  return persistConfirmed(() => persist({
    kind: "hevronia", messageId: deliveredMessageId, senderId: input.senderId,
    senderDisplayName: "Хевронія", chatKind: input.chatKind, text: input.text,
    replyTo: input.replyTo,
  }));
}

async function persistConfirmed(task: () => Promise<void>): Promise<TelegramDeliveryResult> {
  try {
    await task();
    return { status: "delivered", persistence: "stored" };
  } catch (error) {
    console.error(`Telegram delivery confirmed but conversation persistence failed: ${String(error)}`);
    return { status: "delivered", persistence: "failed" };
  }
}
