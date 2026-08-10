import { type BaseMessage } from "@langchain/core/messages";

import { renderDreamChatKind, renderDreamObservations } from "./dream-render.js";
import { extractText } from "./text.js";
import { renderParticipantMemoryContexts } from "./long-term-memory/render-context.js";
import type { ParticipantMemoryContext } from "./participant-memory.js";
import { replyChoices } from "./reply-choices.js";
import { deserializeTelegramEvent, notebookLabel } from "./telegram-event.js";
import type { ReplyCandidate, ResolvedSocialDecision, SocialDecision } from "./social-decision.js";
import type { DeliveredHevroniaMessage, ObservedTelegramMessage, ReplyRelationship } from "./telegram-event.js";

export class InvalidRealizationResponseError extends Error {
  constructor() {
    super("Realization model returned no Telegram message");
    this.name = "InvalidRealizationResponseError";
  }
}

export function isInvalidRealizationResponseError(error: unknown): error is InvalidRealizationResponseError {
  return error instanceof InvalidRealizationResponseError;
}

export function replyCandidates(messages: BaseMessage[]): ReplyCandidate[] {
  const candidates: ReplyCandidate[] = [];
  for (const message of messages) {
    if (message.additional_kwargs["lc_source"] === "summarization") continue;
    const event = deserializeTelegramEvent(extractText(message.content));
    if (event.kind === "participant") {
      candidates.push({
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
  chatKind: "private" | "group" | "supergroup",
  memories: ParticipantMemoryContext[],
  decision: ResolvedSocialDecision,
): string {
  const parts: string[] = [];
  parts.push("What is appearing in the dream now");
  parts.push(renderDreamChatKind(chatKind));
  parts.push(renderDreamObservations(history));
  const memoryText = renderParticipantMemoryContexts(memories);
  if (memoryText !== "") parts.push(memoryText);
  parts.push(renderPrivateDecision(decision));
  parts.push("Make the Telegram message appear. Return only its visible text.");
  return parts.join("\n\n");
}

function renderPrivateDecision(decision: ResolvedSocialDecision): string {
  const target = decision.target;
  const reference = `${notebookLabel(target.sender)}, currently displayed by Telegram as “${target.senderDisplayName}”`;
  return [
    "What you have privately decided:",
    `You have decided to make a Telegram reply appear to ${reference}.`,
    "The visible message you are responding to was:",
    target.text,
    "You understand what happened as:",
    decision.interpretation,
    "The desire currently moving you is:",
    decision.activeDesire,
    "The result you want from speaking is:",
    decision.desiredOutcome,
  ].join("\n");
}

export function resolveDecision(
  decision: Exclude<SocialDecision, { action: "silence" }>,
  candidates: ReplyCandidate[],
): ResolvedSocialDecision | undefined {
  const choice = replyChoices(candidates).find(({ label }) => label === decision.targetChoice);
  if (choice === undefined) return undefined;
  return {
    target: choice.candidate,
    interpretation: decision.interpretation,
    activeDesire: decision.activeDesire,
    desiredOutcome: decision.desiredOutcome,
  };
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
    targetSenderDisplayName: target.senderDisplayName, targetText: target.text,
    targetIsHevronia: false };
}
