import { type BaseMessage } from "@langchain/core/messages";

import { SUMMARY_PREFIX } from "./summary.js";
import { extractText } from "./text.js";
import { renderOwnMessage, renderParticipantMessage } from "./dream-render-replies.js";
import { deserializeTelegramEvent, type CanonicalTelegramEvent } from "./telegram-event.js";
import type { AddressChoice } from "./reply-choices.js";

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
    : `${body}\n\nPlanner reply-message handle: ${replyHandle}.`;
}

/**
 * Renders a bounded message history in the same dream ontology used by both
 * the planner and the realization model. Compaction summaries appear as
 * remembered earlier dream conversation; every other message is a rendered
 * dream event. An optional planner-only annotation map attaches ephemeral
 * reply-message handles to eligible events without exposing message IDs.
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

export function renderDreamCharacterList(characters: readonly AddressChoice[]): string {
  return characters.map(({ character }) => {
    const label = character.subject.charAt(0).toUpperCase() + character.subject.slice(1);
    return `${label}, currently displayed by Telegram as “${character.displayName}”.`;
  }).join("\n");
}

/**
 * The deterministic second-person sentence stating whom Хевронія's upcoming
 * message is socially directed toward. A resolved character uses its stable
 * dream label; a null address means ambient, broadcast speech to everyone
 * present, not an unspecified addressee.
 */
export function addressingSentence(address: AddressChoice | null): string {
  return address === null
    ? "You direct what you say to everyone present."
    : `You direct what you say toward ${address.character.subject}.`;
}
