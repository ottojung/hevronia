import { getConversationLayer } from "./memory.js";
import type { RespondInput } from "./conversation-types.js";
import type { GeneratedTurn } from "./generated-turn.js";
import type { DeliveredHevroniaMessage, TelegramSenderIdentity } from "./telegram-event.js";
import type { ConversationThreadId } from "./identifiers.js";

export async function respond(input: RespondInput): Promise<GeneratedTurn> {
  return getConversationLayer().respond(input);
}

export function recordDeliveredMessage(
  threadId: ConversationThreadId,
  message: DeliveredHevroniaMessage,
): void {
  getConversationLayer().recordDeliveredMessage(threadId, message);
}

export function warmParticipant(sender: TelegramSenderIdentity): void {
  getConversationLayer().warmParticipant(sender);
}
