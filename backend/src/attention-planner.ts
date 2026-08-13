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
import { throwIfAborted } from "./reaction-cancelled.js";
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

Your naming job: the notebook has no natural name yet for each visible person listed under "Names to assign" in the context. For every one of them, answer one question: is there a reasonable Cyrillic way to call this person?

Natural names are for ordinary cognition and speech, not identity replacement: strip technical and display-name clutter and prefer an obvious human core when one is present, do not over-normalize an already-natural name, and never invent a full legal name when only a nickname is needed:
- @Anna → «Анна» or «Аня»
- @SuperBob3000 → «Боб» (strip the numeric/technical clutter and keep the human core)
- @xXAnnaKyivXx → «Анна» or «Аня»
- @dark_sheep_666 → «Даркшіп» or a similar short nickname

When a username or display name has no recognizable human core — for example @wt_t1g3y137 — invent a short plausible conversational nickname that could belong to a person (such as «Вета», «Тіна», «Бор», «Зоя»), chosen to be natural and pronounceable rather than derived from the characters of the handle. Never preserve, transliterate, or rearrange an unreadable handle merely to make it look different, and never return a value that starts with «@» or resembles a machine identifier: the exact @username stays separately available in context for reference.

Use null instead of an alias only when no reasonable nickname occurs to you at all; prefer an invented natural nickname over null for unreadable handles. If the person has no Telegram username, prefer a Cyrillic alias from their display name when it contains a recognizable name; otherwise use null.

Everyone listed under "Names to assign" must receive either a Cyrillic alias or null; nobody outside that list may be given a name or renamed.

Return exactly the required structured output: attention as "yes" or "no", and naturalNames keyed by the exact handles listed under "Names to assign".`;

export class PlannerOutputError extends Error {
  constructor(rendered: string) {
    super(`Attention planner returned an invalid answer: ${rendered}`);
    this.name = "PlannerOutputError";
  }
}

export interface PlannerDecision {
  attention: boolean;
  /** Proposed natural names keyed by the exact naming-choice handles; null means no alias. */
  naturalNames: Readonly<Record<string, string | null>>;
}

export type PlannerDecisionLog =
  | {
      outcome: "pass" | "filter";
      attention: boolean;
      /** Resolved names assigned this turn (after the app's @username fallback). */
      naturalNames: Readonly<Record<string, string>>;
    }
  | { outcome: "failure"; errorDetail: string };

export interface AttentionPlanner {
  consider(
    context: TurnContext,
    namingChoices: readonly MissingNaturalNameChoice[],
    signal?: AbortSignal,
  ): Promise<PlannerDecision>;
}

export function createAttentionPlanner(model: BaseLanguageModel): AttentionPlanner {
  return {
    async consider(
      context: TurnContext,
      namingChoices: readonly MissingNaturalNameChoice[],
      signal?: AbortSignal,
    ): Promise<PlannerDecision> {
      throwIfAborted(signal);
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
      const result = await invokeWithRateLimitRetry(
        () => agent.invoke({
          messages: [new HumanMessage(renderPlannerContext(context, namingChoices))],
        }, { signal }),
        { signal },
      );
      const response = schema.parse(result.structuredResponse);
      return {
        attention: response.attention === "yes",
        naturalNames: response.naturalNames,
      };
    },
  };
}
