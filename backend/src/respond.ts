import { getConversationLayer } from "./memory.js";
import type { RespondInput } from "./conversation-types.js";
import type { GeneratedTurn } from "./generated-turn.js";
import type { DeliveredHevroniaMessage } from "./telegram-event.js";
import type { ConversationThreadId } from "./identifiers.js";

export async function respond(input: RespondInput): Promise<GeneratedTurn> {
  return getConversationLayer().respond(input);
}

export async function recordDeliveredMessage(
  threadId: ConversationThreadId,
  message: DeliveredHevroniaMessage,
): Promise<void> {
  await getConversationLayer().recordDeliveredMessage(threadId, message);
}
