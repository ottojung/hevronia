import { type BaseMessage } from "@langchain/core/messages";

import { extractText } from "./text.js";
import { renderRecalledMemoryContext } from "./long-term-memory/render-context.js";
import { deserializeTelegramEvent } from "./telegram-event.js";
import { renderBoundedConversation, type ReplyCandidate, type ResolvedSocialDecision, type SocialDecision } from "./social-decision.js";
import type { DeliveredHevroniaMessage, ObservedTelegramMessage, ReplyRelationship } from "./telegram-event.js";

export function replyCandidates(messages: BaseMessage[]): ReplyCandidate[] {
  const candidates: ReplyCandidate[] = [];
  for (const message of messages) {
    if (message.additional_kwargs["lc_source"] === "summarization") continue;
    const event = deserializeTelegramEvent(extractText(message.content));
    if (event.kind === "participant") {
      candidates.push({
        key: `candidate-${candidates.length}`,
        messageId: event.messageId,
        sender: event.sender,
        senderDisplayName: event.senderDisplayName,
        text: event.text,
      });
    }
  }
  return candidates;
}

export function realizationContext(
  history: BaseMessage[],
  memories: { text: string }[],
  decision: ResolvedSocialDecision,
): string {
  return `Observed bounded Telegram conversation:\n${renderBoundedConversation(history)}\n\n` +
    `${renderRecalledMemoryContext(memories)}\n\n` +
    `Resolved reply target and social decision: ${JSON.stringify(decision)}\n\n` +
    "Realize that decision. Return only the Telegram text Хевронія sends; never expose planning metadata.";
}

export function resolveDecision(
  decision: Exclude<SocialDecision, { action: "silence" }>,
  candidates: ReplyCandidate[],
): ResolvedSocialDecision | undefined {
  const target = candidates.find(({ key }) => key === decision.targetCandidateKey);
  if (target === undefined) return undefined;
  return { target, motive: decision.motive, socialAction: decision.socialAction,
    adviceRequested: decision.adviceRequested, askQuestion: decision.askQuestion,
    dreamRelevant: decision.dreamRelevant, backgroundRelevant: decision.backgroundRelevant };
}

export function deliveredEvent(
  messageId: number,
  sender: import("./telegram-event.js").TelegramSenderIdentity,
  text: string,
  source: ObservedTelegramMessage,
  target: ReplyCandidate,
): DeliveredHevroniaMessage {
  return { kind: "hevronia", messageId, sender, senderDisplayName: "Хевронія",
    chatKind: source.chatKind, text, messageThreadId: source.messageThreadId,
    replyTo: replyRelationship(target) };
}

export function replyRelationship(target: ReplyCandidate): ReplyRelationship {
  return { targetMessageId: target.messageId, targetSender: target.sender,
    targetSenderDisplayName: target.senderDisplayName, targetText: target.text };
}
