import { type BaseMessage } from "@langchain/core/messages";

import {
  addressingSentence,
  renderDreamCharacterList,
  renderDreamObservations,
} from "./dream-render.js";
import { renderParticipantMemoryContexts } from "./long-term-memory/render-context.js";
import type { ParticipantMemoryContext } from "./participant-memory.js";
import { buildPlannerChoices, type AddressChoice } from "./reply-choices.js";
import { deserializeTelegramEvent } from "./telegram-event.js";
import { extractText } from "./text.js";
import type { SubjectiveState, VisibleMessage } from "./social-decision.js";

export { deliveredEvent, replyRelationshipFor, resolveSpeakDecision } from "./speak-resolution.js";

export function visibleMessages(messages: BaseMessage[]): VisibleMessage[] {
  const result: VisibleMessage[] = [];
  for (const message of messages) {
    if (message.additional_kwargs["lc_source"] === "summarization") continue;
    const event = deserializeTelegramEvent(extractText(message.content));
    if (event.kind === "participant") {
      result.push({
        messageId: event.messageId,
        sender: event.sender,
        senderDisplayName: event.senderDisplayName,
        text: event.text,
      });
    }
  }
  return result;
}

export function realizationContext(
  history: BaseMessage[],
  memories: ParticipantMemoryContext[],
  address: AddressChoice | null,
  subjective: SubjectiveState,
  candidates: VisibleMessage[],
): string {
  const choices = buildPlannerChoices(candidates);
  const parts: string[] = [];
  parts.push("In your dream you currently see these characters:");
  parts.push(renderDreamCharacterList(choices.characters));
  parts.push("");
  parts.push("This is the conversation history currently visible to you:");
  parts.push(renderDreamObservations(history));
  const memoryText = renderParticipantMemoryContexts(memories);
  if (memoryText !== "") parts.push(memoryText);
  parts.push("");
  parts.push([
    addressingSentence(address),
    subjective.interpretation,
    subjective.feltState,
    subjective.activeDesire,
    subjective.desiredOutcome,
    subjective.opportunity,
    subjective.pursuit,
  ].join(" "));
  parts.push("");
  parts.push("Make the Telegram message you choose to speak appear. Return only its visible text.");
  return parts.join("\n\n");
}
