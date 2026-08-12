import { HumanMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { createAgent, providerStrategy, toolStrategy } from "langchain";

import { buildGeminiRealizerJsonSchema, buildOpenAiRealizerJsonSchema } from "./realizer-json-schema.js";
import { invokeWithRateLimitRetry } from "./model-retry.js";
import { isGeminiChatModel } from "./model.js";
import { REALIZER_MODE } from "./realizer-prompt.js";
import {
  buildRealizerResponseSchema,
  type RealizerDecision,
  type TurnContext,
} from "./realizer-schema.js";
import { renderRealizerContext } from "./turn-context.js";

export type RealizerDecisionLog =
  | {
      action: "silence";
      interpretation: string;
      intent: string;
      feltState: string;
      activeDesire: string;
      desiredOutcome: string;
      opportunity: string;
      pursuit: string;
    }
  | {
      action: "speak";
      addressLabel: string | null;
      replyToLabel: string | null;
      interpretation: string;
      intent: string;
      feltState: string;
      activeDesire: string;
      desiredOutcome: string;
      opportunity: string;
      pursuit: string;
    }
  | { action: "failure"; errorDetail: string };

export interface Realizer {
  realize(context: TurnContext): Promise<RealizerDecision>;
}

export function createRealizer(
  model: BaseLanguageModel,
  personality: string,
): Realizer {
  return {
    async realize(context: TurnContext): Promise<RealizerDecision> {
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
      const result = await invokeWithRateLimitRetry(() => agent.invoke({
        messages: [new HumanMessage(renderRealizerContext(context))],
      }));
      const response = schema.parse(result.structuredResponse);
      return response.decision;
    },
  };
}
