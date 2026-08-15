import { HumanMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { createAgent, providerStrategy, toolStrategy } from "langchain";

import { buildGeminiRealizerJsonSchema, buildOpenAiRealizerJsonSchema } from "./realizer-json-schema.js";
import { invokeWithRateLimitRetry } from "./model-retry.js";
import { isGeminiChatModel } from "./model.js";
import { REALIZER_MODE } from "./realizer-prompt.js";
import { throwIfAborted } from "./reaction-cancelled.js";
import {
  buildRealizerResponseSchema,
  type PresentMind,
  type RealizerDecision,
  type RealityCheckJudgment,
  type SubjectiveJudgment,
  type TurnContext,
} from "./realizer-schema.js";
import { renderRealizerContext } from "./turn-context.js";

export type RealizerDecisionLog =
  | {
      action: "silence";
      interpretation: SubjectiveJudgment;
      presentMind: PresentMind;
      characterIntent: SubjectiveJudgment;
      realityCheck: RealityCheckJudgment;
      dreamIntent: SubjectiveJudgment;
      feltState: SubjectiveJudgment;
      activeDesire: SubjectiveJudgment;
      desiredOutcome: SubjectiveJudgment;
      opportunity: SubjectiveJudgment;
      fiveTurnStrategy: SubjectiveJudgment;
      fiftyTurnStrategy: SubjectiveJudgment;
    }
  | {
      action: "speak";
      addressLabel: string | null;
      replyToLabel: string | null;
      interpretation: SubjectiveJudgment;
      presentMind: PresentMind;
      characterIntent: SubjectiveJudgment;
      realityCheck: RealityCheckJudgment;
      dreamIntent: SubjectiveJudgment;
      feltState: SubjectiveJudgment;
      activeDesire: SubjectiveJudgment;
      desiredOutcome: SubjectiveJudgment;
      opportunity: SubjectiveJudgment;
      fiveTurnStrategy: SubjectiveJudgment;
      fiftyTurnStrategy: SubjectiveJudgment;
    }
  | { action: "failure"; errorDetail: string };

export interface Realizer {
  realize(context: TurnContext, signal?: AbortSignal): Promise<RealizerDecision>;
}

export function createRealizer(
  model: BaseLanguageModel,
  personality: string,
): Realizer {
  return {
    async realize(context: TurnContext, signal?: AbortSignal): Promise<RealizerDecision> {
      throwIfAborted(signal);
      const schema = buildRealizerResponseSchema(context.visibleMessages);
      const agent = isGeminiChatModel(model)
        ? createAgent({
            model,
            tools: [],
            systemPrompt: `${personality}\n\n${REALIZER_MODE}`,
            responseFormat: toolStrategy(
              buildGeminiRealizerJsonSchema(context.visibleMessages),
            ),
          })
        : createAgent({
            model,
            tools: [],
            systemPrompt: `${personality}\n\n${REALIZER_MODE}`,
            responseFormat: providerStrategy(
              buildOpenAiRealizerJsonSchema(context.visibleMessages),
            ),
          });
      const result = await invokeWithRateLimitRetry(
        () => agent.invoke({
          messages: [new HumanMessage(renderRealizerContext(context))],
        }, { signal }),
        { signal },
      );
      const response = schema.parse(result.structuredResponse);
      return response.decision;
    },
  };
}
