import { type BaseMessage } from "@langchain/core/messages";

import { SUMMARY_PREFIX } from "./summary.js";
import { extractText } from "./text.js";
import { renderOwnMessage, renderReplyRelationship } from "./dream-render-replies.js";
import {
  deserializeTelegramEvent,
  notebookSubject,
  type CanonicalTelegramEvent,
  type ObservedTelegramMessage,
  type TelegramSenderIdentity,
} from "./telegram-event.js";

/**
 * Renders canonical Telegram events as Хевронія experiences them inside the
 * dream: Telegram messages appear through imagined dream characters, and
 * channel/chat senders are Telegram sources. Person-like senders carry the
 * notebook identity "character N", sources are labelled "channel N", and
 * internal message IDs never appear.
 */
export function renderDreamEvent(
  event: CanonicalTelegramEvent,
  sameSender = false,
  replyChoice?: string,
): string {
  return event.kind === "hevronia"
    ? renderOwnMessage(event)
    : renderParticipantMessage(event, sameSender, replyChoice);
}

/**
 * Renders a bounded message history in the same dream ontology used by both
 * the planner and the realization model. Compaction summaries appear as
 * remembered earlier dream conversation; every other message is a rendered
 * dream event. An optional planner-only annotation map attaches ephemeral
 * reply-choice labels to eligible events without exposing message IDs.
 */
export function renderDreamObservations(
  messages: BaseMessage[],
  replyChoiceAnnotations?: ReadonlyMap<number, string>,
): string {
  const remembered: string[] = [];
  const observations: string[] = [];
  let previousSender: TelegramSenderIdentity | undefined;
  for (const message of messages) {
    const content = extractText(message.content).trim();
    if (message.additional_kwargs["lc_source"] === "summarization") {
      remembered.push(content.replace(SUMMARY_PREFIX, "").trim());
      continue;
    }
    const event = deserializeTelegramEvent(content);
    if (event.kind === "hevronia") {
      observations.push(renderDreamEvent(event));
      previousSender = undefined;
      continue;
    }
    const sameSender = previousSender !== undefined
      && previousSender.kind === event.sender.kind
      && previousSender.id === event.sender.id;
    observations.push(renderDreamEvent(event, sameSender, replyChoiceAnnotations?.get(event.messageId)));
    previousSender = event.sender;
  }
  const parts: string[] = [];
  if (remembered.length > 0) {
    parts.push("What you remember from an earlier part of this same Telegram dream conversation:");
    parts.push(remembered.join("\n"));
  }
  if (observations.length > 0) {
    parts.push("What has appeared in the dream through Telegram:");
    parts.push(observations.join("\n\n"));
  }
  return parts.join("\n\n");
}

export function renderDreamChatKind(chatKind: "private" | "group" | "supergroup"): string {
  return chatKind === "private"
    ? "This part of the dream currently appears as a private Telegram chat."
    : "This part of the dream currently appears as a Telegram group chat.";
}

function renderParticipantMessage(
  event: ObservedTelegramMessage,
  sameSender: boolean,
  replyChoice?: string,
): string {
  const lines: string[] = [];
  const isUser = event.sender.kind === "user";
  const subject = notebookSubject(event.sender);
  if (sameSender) {
    lines.push(isUser
      ? "Another Telegram message appeared through the same dream character."
      : "Another Telegram message appeared from the same Telegram source.");
    lines.push(isUser
      ? `In your notebook this is “${subject}”.`
      : `In your notebook this source is “${subject}”.`);
    lines.push(`Telegram currently displays the name “${event.senderDisplayName}”.`);
  } else {
    lines.push(isUser
      ? "A Telegram message appeared through a dream character."
      : "A Telegram message appeared from a Telegram source in the dream.");
    lines.push(isUser
      ? `In your notebook you labelled it as “${subject}”.`
      : `In your notebook you labelled this source as “${subject}”.`);
    lines.push(`Telegram displays the name “${event.senderDisplayName}”.`);
  }
  if (event.replyTo !== null) {
    lines.push(renderReplyRelationship(event.replyTo));
  }
  if (event.directlyAddressed) {
    lines.push("The way this message appeared makes it directly addressed to you.");
  }
  if (replyChoice !== undefined) {
    lines.push(`You could reply directly to this message as reply choice ${replyChoice}.`);
  }
  lines.push("Visible message:");
  lines.push(event.text);
  return lines.join("\n");
}
