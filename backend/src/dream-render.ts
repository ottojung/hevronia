import { type BaseMessage } from "@langchain/core/messages";

import { SUMMARY_PREFIX } from "./summary.js";
import { extractText } from "./text.js";
import {
  deserializeTelegramEvent,
  spreadsheetSubject,
  type CanonicalTelegramEvent,
  type DeliveredHevroniaMessage,
  type ObservedTelegramMessage,
  type ReplyRelationship,
  type TelegramSenderIdentity,
} from "./telegram-event.js";

/**
 * Renders canonical Telegram events as Хевронія experiences them inside the
 * dream: imagined characters produce visible Telegram messages, and she
 * herself chooses which Telegram messages to make appear. Internal sender
 * kinds and IDs are never shown; identities appear as spreadsheet labels.
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
  if (sameCharacter) {
    lines.push(
      `The same dream character, shown as “${event.senderDisplayName}” (your spreadsheet: ${spreadsheetSubject(event.sender)}), produced another visible Telegram message.`,
    );
  } else {
    lines.push("A Telegram message appeared through a dream character.");
    lines.push(
      `Telegram displays the name “${event.senderDisplayName}”; in your spreadsheet this character is ${spreadsheetSubject(event.sender)}.`,
    );
  }
  if (event.replyTo !== null) {
    lines.push(renderReplyRelationship(event.replyTo));
  }
  if (event.directlyAddressed) {
    lines.push("The way it appeared makes it directly addressed to you.");
  }
  lines.push(`Visible message ${event.messageId}:`);
  lines.push(event.text);
  return lines.join("\n");
}

function renderOwnMessage(event: DeliveredHevroniaMessage): string {
  if (event.replyTo === null) {
    return `Earlier, you chose to make this Telegram message appear.\n\n${event.text}`;
  }
  return [
    `Earlier, you chose to make this Telegram message appear as a reply to message ${event.replyTo.targetMessageId}, which came from the character displayed as “${event.replyTo.targetSenderDisplayName}”.`,
    "",
    event.text,
  ].join("\n");
}

function renderReplyRelationship(relationship: ReplyRelationship): string {
  const text = relationship.targetText === null
    ? ""
    : ` That earlier message showed: ${relationship.targetText}`;
  return `Telegram visually connects this message as a reply to message ${relationship.targetMessageId}, which appeared from the character displayed as “${relationship.targetSenderDisplayName}”.${text}`;
}
