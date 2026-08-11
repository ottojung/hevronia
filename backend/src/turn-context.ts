import { type BaseMessage } from "@langchain/core/messages";

import { renderCurrentEventContext, renderDreamCharacterList, renderDreamObservations } from "./dream-render.js";
import { buildHandleChoices } from "./handles.js";
import { renderParticipantMemoryContexts } from "./long-term-memory/render-context.js";
import type { TurnContext, VisibleMessage } from "./realizer-schema.js";
import { deserializeTelegramEvent } from "./telegram-event.js";
import { extractText } from "./text.js";

export { deliveredEvent, replyRelationshipFor, resolveRealizerDecision } from "./speak-resolution.js";

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

export function renderRealizerContext(context: TurnContext): string {
  const choices = buildHandleChoices(context.visibleMessages);
  const sections: string[] = [];
  sections.push("In your dream you currently see these characters:");
  sections.push(renderDreamCharacterList(choices.characters));
  sections.push("");
  sections.push("This is the conversation history currently visible to you:");
  sections.push(renderDreamObservations(context.boundedHistory, choices.messageAnnotations));
  sections.push("");
  sections.push("Character handles (addressCharacter must be one of these):");
  sections.push(choices.characters.map(({ handle, character }) =>
    `${handle} = ${character.subject}`).join("\n"));
  sections.push("");
  sections.push("Reply-message handles (replyToMessage must be one of these, or null):");
  sections.push(choices.messages.map(({ handle }, index) =>
    `${handle} = ${ordinal(index + 1)} eligible visible message`).join("\n"));
  const memories = renderParticipantMemoryContexts(context.participantMemories);
  if (memories !== "") {
    sections.push("");
    sections.push(memories);
  }
  sections.push("");
  sections.push(renderCurrentEventContext(context.currentMessage));
  return sections.join("\n\n");
}

function ordinal(value: number): string {
  if (value === 1) return "the first";
  if (value === 2) return "the second";
  if (value === 3) return "the third";
  return `the ${value}th`;
}
