import { type BaseMessage } from "@langchain/core/messages";

import { renderDreamCharacterList, renderDreamObservations } from "./dream-render.js";
import { renderParticipantMemoryContexts } from "./long-term-memory/render-context.js";
import type { ParticipantMemoryContext } from "./participant-memory.js";
import { buildPlannerChoices } from "./reply-choices.js";
import { deserializeTelegramEvent } from "./telegram-event.js";
import { extractText } from "./text.js";
import type { SubjectiveState, VisibleMessage } from "./social-decision.js";
import { subjectiveParagraph } from "./social-decision.js";

export { deliveredEvent, replyRelationshipFor, resolveSpeakDecision } from "./speak-resolution.js";

export class InvalidRealizationResponseError extends Error {
  constructor() {
    super("Realization model returned no Telegram message");
    this.name = "InvalidRealizationResponseError";
  }
}

export function isInvalidRealizationResponseError(error: unknown): error is InvalidRealizationResponseError {
  return error instanceof InvalidRealizationResponseError;
}

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
  parts.push(subjectiveParagraph(subjective));
  parts.push("");
  parts.push("Make the Telegram message you choose to speak appear. Return only its visible text.");
  return parts.join("\n\n");
}
