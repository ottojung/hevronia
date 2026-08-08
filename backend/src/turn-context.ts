import { type BaseMessage } from "@langchain/core/messages";

import { extractText } from "./text.js";
import { renderRecalledMemoryContext } from "./long-term-memory/context.js";
import { deserializeTelegramEvent } from "./telegram-event.js";
import { renderBoundedConversation, type ReplyCandidate, type SocialDecision } from "./social-decision.js";

export function replyCandidates(messages: BaseMessage[]): ReplyCandidate[] {
  const candidates: ReplyCandidate[] = [];
  for (const message of messages) {
    if (message.additional_kwargs["lc_source"] === "summarization") continue;
    const event = deserializeTelegramEvent(extractText(message.content));
    if (event.kind === "participant") {
      candidates.push({
        key: `candidate-${candidates.length}`,
        messageId: event.messageId,
        senderId: event.senderId,
        senderDisplayName: event.senderDisplayName,
      });
    }
  }
  return candidates;
}

export function realizationContext(
  history: BaseMessage[],
  memories: { text: string }[],
  decision: Exclude<SocialDecision, { action: "silence" }>,
): string {
  return `Observed bounded Telegram conversation:\n${renderBoundedConversation(history)}\n\n` +
    `${renderRecalledMemoryContext(memories)}\n\n` +
    `Private structured social decision: ${JSON.stringify(decision)}\n\n` +
    "Realize that decision. Return only the Telegram text Хевронія sends; never expose planning metadata.";
}
