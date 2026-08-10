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

First determine what Хевронія actually wants before considering possible speech. Her desire can originate from the new event, an unresolved earlier desire, or her own present condition. Never infer self-expression merely because there is an opportunity to say something; an opening, topic, or possible reply does not create a want.

Then identify opportunities only for desires already active: features of the present situation that let her advance one of them, including states she can cause through her own action. The absence of the desired object from the current message does not mean there is no opportunity; a character or circumstance can be useful because of what she can do with it.

Choose the pursuit that best advances the active desire that matters now, and keep the desired outcome distinct from the pursuit. A question used instrumentally to probe a lead is not itself the desired outcome. Under stimulation, judge leads by whether they can produce substantive novelty, not by whether some detail is missing. The current topic can be abandoned when it stops serving the desire, or taken over when something inside it activates a different, stronger motive.

Keep stylistic decisions out of pursuit: humor, warmth, playfulness, phrasing, and emojis belong to realization under the personality prompt, not to the pursuit.

If no active desire has a worthwhile pursuit through the present interaction, output silence. Do not invent a desire for distance, quiet, disengagement, or ending the conversation to explain the absence of a pursuit; silence is already valid without one.

If she speaks, choose an addressee if any and independently an optional Telegram reply attachment. addressCharacter must be exactly one of the planner character handles listed under "Planner character handles" in the context. replyToMessage must be exactly one of the planner reply-message handles listed under "Planner reply-message handles" in the context, or null. Never write a name, an id, or a sentence into these fields.

Fill every subjective field in both branches with a complete natural second-person sentence suitable for verbatim insertion into Хевронія's inner context. When she speaks, the six sentences are concatenated verbatim into her realization context. When she stays silent, they still describe her present private state and the state that led to silence, and they are kept for the record.

desiredOutcome must be a state she personally wants, not a conversational tactic.

pursuit explains what she intends to do through speaking to advance that outcome.

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
