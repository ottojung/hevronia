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
 * dream: imagined dream characters produce visible Telegram messages, and she
 * herself chooses which Telegram messages to make appear. Person-like senders
 * are labelled with the notebook identity "character N", chats and channels
 * are sources labelled "channel N", and internal message IDs never appear.
 */
export function renderDreamEvent(
  event: CanonicalTelegramEvent,
  sameCharacter = false,
): string {
  return event.kind === "hevronia"
    ? renderOwnMessage(event)
    : renderParticipantMessage(event, sameCharacter);
}

/**
 * Renders a bounded message history in the same dream ontology used by both
 * the planner and the realization model. Compaction summaries appear as
 * remembered earlier dream conversation; every other message is a rendered
 * dream event.
 */
export function renderDreamObservations(messages: BaseMessage[]): string {
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
    const sameCharacter = previousSender !== undefined
      && previousSender.kind === event.sender.kind
      && previousSender.id === event.sender.id;
    observations.push(renderDreamEvent(event, sameCharacter));
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

function renderParticipantMessage(event: ObservedTelegramMessage, sameCharacter: boolean): string {
  const lines: string[] = [];
  const subject = notebookSubject(event.sender);
  if (sameCharacter) {
    lines.push("Another Telegram message appeared through the same dream character.");
    lines.push(event.sender.kind === "user"
      ? `In your notebook this is “${subject}”.`
      : `In your notebook this source is “${subject}”.`);
    lines.push(`Telegram currently displays the name “${event.senderDisplayName}”.`);
  } else {
    lines.push("A Telegram message appeared through a dream character.");
    lines.push(event.sender.kind === "user"
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
  lines.push("Visible message:");
  lines.push(event.text);
  return lines.join("\n");
}
