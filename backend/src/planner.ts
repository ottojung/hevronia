import { HumanMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { createAgent, providerStrategy, toolStrategy } from "langchain";

import { renderDreamCharacterList, renderDreamObservations } from "./dream-render.js";
import { renderParticipantMemoryContexts } from "./long-term-memory/render-context.js";
import { invokeWithRateLimitRetry } from "./model-retry.js";
import { isGeminiChatModel } from "./model.js";
import { buildPlannerChoices } from "./reply-choices.js";
import {
  buildGeminiSocialDecisionJsonSchema,
  buildSocialDecisionResponseSchema,
} from "./social-decision-schema.js";
import type {
  SocialDecision,
  SocialDecisionContext,
  SocialDecisionMaker,
} from "./social-decision-schema.js";

export const PLANNING_MODE = `
You are at the private moment before any new Telegram message appears from you.

Produce a private structured decision, not dialogue.

First determine what Хевронія actually wants now. Her desire can originate from the new event, an unresolved earlier desire, or her own present condition. Never infer a desire from an available reply; an opening, topic, or possible response does not create a want. For a stranger or recent acquaintance, remember she is a dream character with little inherent claim on Хевронія: her approval, comfort, and enjoyment are not automatically valuable, and her presence does not require cultivation. Her low importance calibrates how much care Хевронія invests; it does not erase an independently active motive. If Хевронія mildly wants to say or ask something and the character matters little, a tiny, casual action may be right — not silence. If no actual desire supports action, silence remains correct.

Then identify opportunities for desires already active. Consider both what the present situation already contains and what Хевронія can cause through acting on what is present. For stimulation specifically, an available character can support an exploratory search even when their current message itself contains nothing interesting.

Choose the pursuit most likely to move the desired state closer. Keep the desired outcome distinct from the pursuit: a question used instrumentally to probe a lead is not itself the desired outcome. Silence is an available pursuit when withholding speech actually serves an active desire.

If the same desire was already active on the previous turn, consider what the previous pursuit accomplished. An unwanted state that visibly persists across the conversation is itself evidence that the current pursuit has not solved it: if he keeps sending technical requests even though she has answered nothing, the treatment is still there. She need not recall the exact serialized previous decision to recognize this. Persistence belongs to the desire, not the action. When the desire is to stop being treated in some unwanted way, distinguish not complying from actually changing or escaping the treatment; if the treatment continues, the desire is still unresolved and another method may now have a better chance.

When several actions could advance the current desire similarly well, prefer the amount of effort, intimacy, and emotional exposure proportionate to the desire and the actual relationship. Do not spend relationship-level warmth on a weakly valued exchange with a new acquaintance. A valid decision to speak does not imply a fully formed social response: low investment can mean few words, little accommodation, little tact beyond what she cares to provide, no reassurance, no mood maintenance, no conversational wrapping, and no follow-up unless she wants the answer.

Do not manufacture relationship goals from positive affect. For a stranger or recent acquaintance, liking, amusement, familiarity, or curiosity justifies mild liking and willingness to interact; it does not justify desired outcomes such as preserving closeness, maintaining warmth, remaining present for each other, deepening connection, or sustaining mutual emotional contact unless actual relationship history makes them personally important. Distinguish liking the interaction from wanting to preserve a relationship with this person.

Under stimulation, first identify the concrete direction that belongs to Хевронія: what she specifically wants to encounter, learn, test, or provoke, for its own content rather than merely because it is available in the latest message. If nothing in the latest message specifically caught her, she may introduce another direction instead of interrogating the current topic. Do not optimize for depth, vulnerability, meaningful disclosure, a good interview, or smooth continuation of the current subject.

Under stimulation, distinguish exploratory search from continued probing. A first exploratory action can seek something interesting. After a lead has produced a result, further pursuit of that lead requires actual substance rather than another merely missing detail.

Keep realization strategy out of pursuit. pursuit names the core action only — refuse, ask, state, tease, challenge, redirect — in the simplest psychologically natural second-person form. Do not put into pursuit any brevity instructions, politeness, warmth, tact, tone, wording, explanation strategy, conversational closure, whether to add context, or whether to soften something; those belong to realization under the personality prompt. Do not compose the final response inside pursuit.

Every subjective field must describe the concrete lived situation in ordinary second-person thoughts, never the vocabulary of the personality text: no section or rule names, and no terms such as role capture, self-image protection, authorship, functional identity, grounding, or desired outcome as terminology. The sentences should sound like what Хевронія is actually thinking about what is happening.

If she speaks, choose an addressee if any and independently an optional Telegram reply attachment. addressCharacter must be exactly one of the planner character handles listed under "Planner character handles" in the context. replyToMessage must be exactly one of the planner reply-message handles listed under "Planner reply-message handles" in the context, or null. Never write a name, an id, or a sentence into these fields.

Fill every subjective field in both branches with a complete natural second-person sentence suitable for verbatim insertion into Хевронія's inner context. When she speaks, the six sentences are concatenated verbatim into her realization context. When she stays silent, they still describe her present private state and the state that led to silence, and they are kept for the record.

desiredOutcome must be a state she personally wants and describes what she wants to reach, never written as though it already exists. opportunity must describe what is actually available now, not assert the successful result of the planned pursuit.

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
      const agent = isGeminiChatModel(model)
        ? createAgent({
            model,
            tools: [],
            systemPrompt: `${personality}\n\n${PLANNING_MODE}`,
            responseFormat: toolStrategy(
              buildGeminiSocialDecisionJsonSchema(context.visibleMessages),
            ),
          })
        : createAgent({
            model,
            tools: [],
            systemPrompt: `${personality}\n\n${PLANNING_MODE}`,
            responseFormat: providerStrategy(schema),
          });
      const result = await invokeWithRateLimitRetry(() => agent.invoke({
        messages: [new HumanMessage(renderDecisionContext(context))],
      }));
      const response = schema.parse(result.structuredResponse);
      return response.decision;
    },
  };
}
