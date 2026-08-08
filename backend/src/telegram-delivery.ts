import type { GeneratedTurn } from "./generated-turn.js";

export interface TelegramTurnDelivery {
  showTyping(): Promise<void>;
  reply(text: string, replyToMessageId: number): Promise<void>;
}

export async function deliverGeneratedTurn(
  turn: GeneratedTurn,
  delivery: TelegramTurnDelivery,
): Promise<boolean> {
  if (turn.outcome.action === "silence") {
    return false;
  }
  await delivery.showTyping();
  await delivery.reply(turn.outcome.replyText, turn.outcome.replyToMessageId);
  return true;
}
