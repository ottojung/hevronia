import { type BaseMessage } from "@langchain/core/messages";

import { SUMMARY_PREFIX } from "./summary.js";
import { extractText } from "./text.js";
import { renderOwnMessage, renderParticipantMessage } from "./dream-render-replies.js";
import {
  deserializeTelegramEvent,
  type CanonicalTelegramEvent,
  type ObservedTelegramMessage,
} from "./telegram-event.js";
import type { CharacterHandle } from "./handles.js";

/**
 * Renders canonical Telegram events as Хевронія experiences them inside the
 * dream: other characters' utterances are products appearing through her
 * sleeping mind, while her own earlier delivered messages are actions she
 * chose. Stable dream-character labels identify participants; Telegram
 * display names and internal message IDs never appear.
 */
export function renderDreamEvent(event: CanonicalTelegramEvent, replyHandle?: string): string {
  const body = event.kind === "hevronia"
    ? renderOwnMessage(event)
    : renderParticipantMessage(event);
  return replyHandle === undefined
    ? body
    : `${body}\n\nReply-message handle: ${replyHandle}.`;
}

/**
 * Renders a bounded message history in the same dream ontology used by the
 * attention planner, the smart realizer, and the summary model. Compaction
 * summaries appear as remembered earlier dream conversation; every other
 * message is a rendered dream event. An optional annotation map attaches
 * ephemeral reply-message handles to eligible events without exposing message
 * IDs.
 */
export function renderDreamObservations(
  messages: BaseMessage[],
  replyChoiceAnnotations?: ReadonlyMap<number, string>,
): string {
  const remembered: string[] = [];
  const observations: string[] = [];
  for (const message of messages) {
    const content = extractText(message.content).trim();
    if (message.additional_kwargs["lc_source"] === "summarization") {
      remembered.push(content.replace(SUMMARY_PREFIX, "").trim());
      continue;
    }
    const event = deserializeTelegramEvent(content);
    observations.push(renderDreamEvent(event, replyChoiceAnnotations?.get(event.messageId)));
  }
  const parts: string[] = [];
  if (remembered.length > 0) {
    parts.push("What you remember from an earlier part of this same Telegram dream conversation:");
    parts.push(remembered.join("\n"));
  }
  if (observations.length > 0) {
    parts.push(observations.join("\n\n"));
  }
  return parts.join("\n\n");
}

export function renderDreamCharacterList(characters: readonly CharacterHandle[]): string {
  return characters.map(({ character }) => {
    const label = character.subject.charAt(0).toUpperCase() + character.subject.slice(1);
    return `${label}, currently displayed by Telegram as “${character.displayName}”.`;
  }).join("\n");
}

/**
 * Renders the social environment of the whole conversation once, so the
 * models do not have to guess whether a "привіт" was a private message or
 * ambient group chatter. The framing is a property of the thread, not of any
 * single message, so it never singles out the latest event as the one Хевронія
 * is expected to answer.
 */
export function renderConversationFraming(chatKind: ObservedTelegramMessage["chatKind"]): string {
  if (chatKind === "private") {
    return "This is a private chat: every message here is addressed to you, and only the two of you can see it.";
  }
  return "This is a group chat, where most messages are not addressed to you; only messages marked as such are.";
}
