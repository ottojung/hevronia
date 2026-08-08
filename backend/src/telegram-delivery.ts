import type { GeneratedTurn } from "./generated-turn.js";

export interface TelegramTurnDelivery {
  showTyping(): Promise<void>;
  reply(text: string, replyToMessageId: number): Promise<number>;
}

export async function deliverGeneratedTurn(
  turn: GeneratedTurn,
  delivery: TelegramTurnDelivery,
): Promise<boolean> {
  if (turn.outcome.action === "silence") {
    await turn.outcome.completeObservation();
    return false;
  }
  await delivery.showTyping();
  const deliveredMessageId = await delivery.reply(
    turn.outcome.replyText,
    turn.outcome.replyToMessageId,
  );
  await turn.outcome.completeDelivery(deliveredMessageId);
  return true;
}
