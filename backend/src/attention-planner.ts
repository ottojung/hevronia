import { HumanMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { createAgent, providerStrategy, toolStrategy } from "langchain";

import { invokeWithRateLimitRetry } from "./model-retry.js";
import { isGeminiChatModel } from "./model.js";
import { renderPlannerContext } from "./planner-context.js";
import {
  buildPlannerJsonSchema,
  buildPlannerResponseSchema,
  type MissingNaturalNameChoice,
} from "./planner-schema.js";
import type { TurnContext } from "./realizer-schema.js";

export { missingNaturalNameChoices, buildPlannerResponseSchema, buildPlannerJsonSchema } from "./planner-schema.js";
export type { MissingNaturalNameChoice } from "./planner-schema.js";
export { renderPlannerContext } from "./planner-context.js";

export const PLANNER_PROMPT = `You are a cheap attention pre-filter and name-assigner for Хевронія, a character inside a dream that appears to her through Telegram.

Your attention job is to decide whether there is any plausible reason for Хевронія to consider responding to what is happening now. You are NOT deciding whether she should actually reply, whom she should address, what she feels, what she wants, or what she should say. That belongs to a later, smarter stage. You are a recall-oriented gate: when in doubt, say yes.

Say "yes" when there is a plausible indication that Хевронія may care enough to consider acting, including when:
- she is directly addressed, directly mentioned, or referred to indirectly;
- somebody replies to or meaningfully continues something she said;
- somebody answers a question she asked;
- an earlier interaction involving her is still unresolved;
- something changes in a situation she was already participating in;
- somebody is clearly trying to get her attention without naming her;
- an event is socially striking, funny, provocative, concerning, surprising, personally relevant, or otherwise plausibly something she could want to react to;
- relevant relationship history or memory makes an otherwise ordinary message potentially important to her;
- there is genuine ambiguity about whether she may want to react.

Say "no" only for ordinary background chatter where there is no plausible reason for Хевронія to get involved. You may also say "no" when something directed at her has already been completely dealt with and the new event adds nothing material, but apply this conservatively. You are a gate, not Хевронія's social mind.

Your naming job: the notebook has no natural name yet for each visible person listed under "Names to assign" in the context. For every one of them, choose exactly one short natural name that Хевронія would comfortably use in conversation. Derive it from the person's Telegram display name or username where one suggests a name, and otherwise pick something short and natural. Everyone listed under "Names to assign" must receive a name; nobody outside that list may be given a name or renamed. Names stay short, colloquial, and conversational — normally one or two words, in the language of the conversation (Ukrainian) when the source is Ukrainian, transliterated naturally when the source is foreign. Do not use a raw handle, a description, or a bare Telegram username as the name.

Return exactly the required structured output: attention as "yes" or "no", and naturalNames keyed by the exact handles listed under "Names to assign".`;

export class PlannerOutputError extends Error {
  constructor(rendered: string) {
    super(`Attention planner returned an invalid answer: ${rendered}`);
    this.name = "PlannerOutputError";
  }
}

export interface PlannerDecision {
  attention: boolean;
  /** Proposed natural names keyed by the exact naming-choice handles. */
  naturalNames: Readonly<Record<string, string>>;
}

export type PlannerDecisionLog =
  | {
      outcome: "pass" | "filter";
      attention: boolean;
      naturalNames: Readonly<Record<string, string>>;
    }
  | { outcome: "failure"; errorDetail: string };

export interface AttentionPlanner {
  consider(
    context: TurnContext,
    namingChoices: readonly MissingNaturalNameChoice[],
  ): Promise<PlannerDecision>;
}

export function createAttentionPlanner(model: BaseLanguageModel): AttentionPlanner {
  return {
    async consider(
      context: TurnContext,
      namingChoices: readonly MissingNaturalNameChoice[],
    ): Promise<PlannerDecision> {
      // Nothing to name and the event is unambiguously directed at Хевронія:
      // skip the model entirely, because the gate must never turn a private
      // chat or a direct address into an irreversible false negative.
      if (namingChoices.length === 0 &&
          (context.currentMessage.chatKind === "private"
            || context.currentMessage.directlyAddressed)) {
        return { attention: true, naturalNames: {} };
      }
      const schema = buildPlannerResponseSchema(namingChoices);
      const agent = isGeminiChatModel(model)
        ? createAgent({
            model,
            tools: [],
            systemPrompt: PLANNER_PROMPT,
            responseFormat: toolStrategy(buildPlannerJsonSchema(namingChoices)),
          })
        : createAgent({
            model,
            tools: [],
            systemPrompt: PLANNER_PROMPT,
            responseFormat: providerStrategy(buildPlannerJsonSchema(namingChoices)),
          });
      const result = await invokeWithRateLimitRetry(() => agent.invoke({
        messages: [new HumanMessage(renderPlannerContext(context, namingChoices))],
      }));
      const response = schema.parse(result.structuredResponse);
      return {
        attention: response.attention === "yes",
        naturalNames: response.naturalNames,
      };
    },
  };
}
