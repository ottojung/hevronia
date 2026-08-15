import { renderConversationFraming, renderDreamCharacterList, renderDreamObservations } from "./dream-render.js";
import { buildHandleChoices } from "./handles.js";
import { renderParticipantMemoryContexts } from "./long-term-memory/render-context.js";
import type { MissingNaturalNameChoice } from "./planner-schema.js";
import type { TurnContext } from "./realizer-response-schema.js";
import { notebookSubject } from "./telegram-event.js";

export function renderPlannerContext(
  context: TurnContext,
  namingChoices: readonly MissingNaturalNameChoice[],
): string {
  const choices = buildHandleChoices(context.visibleMessages, context.naturalNames);
  const sections: string[] = [];
  sections.push("In your dream you currently see these characters:");
  sections.push(renderDreamCharacterList(choices.characters));
  if (namingChoices.length > 0) {
    sections.push("");
    sections.push("Names to assign:");
    sections.push(namingChoices.map(({ handle, sender, displayName, username }) => {
      const user = username === null || username === "" ? "" : `, username @${username}`;
      return `${handle} = ${notebookSubject(sender)}, currently displayed as “${displayName}”${user}.`;
    }).join("\n"));
  }
  sections.push("");
  sections.push("This is the conversation history currently visible to you:");
  sections.push(renderDreamObservations(context.boundedHistory, undefined, context.naturalNames));
  sections.push("");
  sections.push(renderConversationFraming(context.currentMessage.chatKind));
  const memories = renderParticipantMemoryContexts(context.participantMemories);
  if (memories !== "") {
    sections.push("");
    sections.push(memories);
  }
  sections.push("");
  sections.push("Is there any plausible reason for Хевронія to consider responding to what is happening now?");
  return sections.join("\n\n");
}
