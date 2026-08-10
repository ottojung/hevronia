import { HumanMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { createAgent, providerStrategy } from "langchain";

import { renderDreamCharacterList, renderDreamObservations } from "./dream-render.js";
import { renderParticipantMemoryContexts } from "./long-term-memory/render-context.js";
import { buildPlannerChoices } from "./reply-choices.js";
import { socialDecisionResponseSchema } from "./social-decision-schema.js";
import type {
  SocialDecision,
  SocialDecisionContext,
  SocialDecisionMaker,
} from "./social-decision-schema.js";

export const PLANNING_MODE = `
You are at the private moment before any new Telegram message appears from you.

Produce a private structured decision, not dialogue.

First determine Хевронія's present psychological state using the personality prompt and the dream context you are given.

Determine what she currently wants. Her desire can originate from the new event, an unresolved earlier desire, or her own present condition.

Treat the conversation as an environment of opportunities, not as a queue of messages requiring responses.

Decide whether speaking now provides a meaningful pursuit of something she herself wants.

If not, output silence.

If yes, select an addressee if any, independently select an optional Telegram reply attachment, and fill every subjective field with a complete natural second-person sentence suitable for verbatim insertion into Хевронія's inner context.

desiredOutcome must be a state she personally wants, not a conversational tactic.

pursuit explains what she intends to do through speaking to advance that outcome.

The current topic has no privileged status. For every decision, consider whether the present character or room offers an opportunity to pursue something else she wants.

Return only the required structured output.
`;

export function renderDecisionContext(context: SocialDecisionContext): string {
  const choices = buildPlannerChoices(context.visibleMessages);
  const sections: string[] = [];
  sections.push("In your dream you currently see these characters:");
  sections.push(renderDreamCharacterList(choices.characters));
  sections.push("");
  sections.push("This is the conversation history currently visible to you:");
  sections.push(renderDreamObservations(context.boundedHistory, choices.messageAnnotations));
  sections.push("");
  sections.push("Planner character handles:");
  sections.push(choices.characters.map(({ handle, character }) =>
    `${handle} = ${character.subject}`).join("\n"));
  sections.push("");
  sections.push("Planner reply-message handles:");
  sections.push(choices.messages.map(({ handle }, index) =>
    `${handle} = ${ordinal(index + 1)} eligible visible message`).join("\n"));
  const memories = renderParticipantMemoryContexts(context.participantMemories);
  if (memories !== "") {
    sections.push("");
    sections.push(memories);
  }
  return sections.join("\n\n");
}

function ordinal(value: number): string {
  if (value === 1) return "the first";
  if (value === 2) return "the second";
  if (value === 3) return "the third";
  return `the ${value}th`;
}

export function createSocialDecisionMaker(
  model: BaseLanguageModel,
  personality: string,
): SocialDecisionMaker {
  const agent = createAgent({
    model,
    tools: [],
    systemPrompt: `${personality}\n\n${PLANNING_MODE}`,
    responseFormat: providerStrategy(socialDecisionResponseSchema),
  });
  return {
    async decide(context: SocialDecisionContext): Promise<SocialDecision> {
      const result = await agent.invoke({
        messages: [new HumanMessage(renderDecisionContext(context))],
      });
      const response = socialDecisionResponseSchema.parse(result.structuredResponse);
      return response.decision;
    },
  };
}
