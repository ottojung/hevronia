import { HumanMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { createAgent, providerStrategy } from "langchain";

import { renderDreamCharacterList, renderDreamObservations } from "./dream-render.js";
import { renderParticipantMemoryContexts } from "./long-term-memory/render-context.js";
import { buildPlannerChoices } from "./reply-choices.js";
import { buildSocialDecisionResponseSchema } from "./social-decision-schema.js";
import type {
  SocialDecision,
  SocialDecisionContext,
  SocialDecisionMaker,
} from "./social-decision-schema.js";

export const PLANNING_MODE = `
You are at the private moment before any new Telegram message appears from you.

Produce a private structured decision, not dialogue.

First determine what Хевронія actually wants now. Her desire can originate from the new event, an unresolved earlier desire, or her own present condition. Never infer a desire from an available reply; an opening, topic, or possible response does not create a want.

Then identify opportunities for desires already active. Consider both what the present situation already contains and what Хевронія can cause through acting on what is present. For stimulation specifically, an available character can support an exploratory search even when their current message itself contains nothing interesting.

Choose the pursuit most likely to move the desired state closer. Keep the desired outcome distinct from the pursuit: a question used instrumentally to probe a lead is not itself the desired outcome. Silence is an available pursuit when withholding speech actually serves an active desire.

If the same desire was already active on the previous turn, consider what the previous pursuit accomplished. If it did not move the relevant state closer, do not repeat it mechanically; choose another method when another available pursuit now has a better chance of advancing the same desire. Persistence belongs to the desire, not the action.

Under stimulation, distinguish exploratory search from continued probing. A first exploratory action can seek something interesting. After a lead has produced a result, further pursuit of that lead requires actual substance rather than another merely missing detail.

Keep stylistic realization out of pursuit. Do not put instructions such as adding humor, sounding warm, answering playfully, or using an emoji into pursuit.

Every subjective field must describe the concrete lived situation in ordinary second-person thoughts, never the vocabulary of the personality text: no section or rule names, and no terms such as role capture, self-image protection, authorship, functional identity, grounding, or desired outcome as terminology. The sentences should sound like what Хевронія is actually thinking about what is happening.

If she speaks, choose an addressee if any and independently an optional Telegram reply attachment. addressCharacter must be exactly one of the planner character handles listed under "Planner character handles" in the context. replyToMessage must be exactly one of the planner reply-message handles listed under "Planner reply-message handles" in the context, or null. Never write a name, an id, or a sentence into these fields.

Fill every subjective field in both branches with a complete natural second-person sentence suitable for verbatim insertion into Хевронія's inner context. When she speaks, the six sentences are concatenated verbatim into her realization context. When she stays silent, they still describe her present private state and the state that led to silence, and they are kept for the record.

desiredOutcome must be a state she personally wants, not a conversational tactic.

pursuit describes the chosen action through which she tries to bring that state about, including intentional silence.

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
  sections.push("Planner character handles (addressCharacter must be one of these):");
  sections.push(choices.characters.map(({ handle, character }) =>
    `${handle} = ${character.subject}`).join("\n"));
  sections.push("");
  sections.push("Planner reply-message handles (replyToMessage must be one of these, or null):");
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
  return {
    async decide(context: SocialDecisionContext): Promise<SocialDecision> {
      const schema = buildSocialDecisionResponseSchema(context.visibleMessages);
      const agent = createAgent({
        model,
        tools: [],
        systemPrompt: `${personality}\n\n${PLANNING_MODE}`,
        responseFormat: providerStrategy(schema),
      });
      const result = await agent.invoke({
        messages: [new HumanMessage(renderDecisionContext(context))],
      });
      const response = schema.parse(result.structuredResponse);
      return response.decision;
    },
  };
}
