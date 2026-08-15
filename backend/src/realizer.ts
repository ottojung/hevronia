import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { REALIZER_MODE } from "./realizer-prompt.js";
import { throwIfAborted } from "./reaction-cancelled.js";
import {
  generateValidatedDecision,
  type StructuredOutputChatModel,
} from "./realizer-call.js";
import { buildRealizerResponseSchema, type TurnContext } from "./realizer-response-schema.js";
import {
  type ActiveDesire,
  type PresentMind,
  type RealizerDecision,
} from "./realizer-schema.js";
import { renderRealizerContext } from "./turn-context.js";

export type RealizerDecisionLog =
  | {
      action: "silence";
      interpretation: string;
      presentMind: PresentMind;
      characterIntent: string;
      realityCheck: string;
      dreamIntent: string;
      feltState: string;
      activeDesire: ActiveDesire;
      desiredOutcome: string;
      opportunity: string;
      fiveTurnStrategy: string;
      fiftyTurnStrategy: string;
    }
  | {
      action: "speak";
      addressLabel: string | null;
      replyToLabel: string | null;
      interpretation: string;
      presentMind: PresentMind;
      characterIntent: string;
      realityCheck: string;
      dreamIntent: string;
      feltState: string;
      activeDesire: ActiveDesire;
      desiredOutcome: string;
      opportunity: string;
      fiveTurnStrategy: string;
      fiftyTurnStrategy: string;
    }
  | { action: "failure"; errorDetail: string };

export interface Realizer {
  realize(context: TurnContext, signal?: AbortSignal): Promise<RealizerDecision>;
}

/**
 * The realizer is one direct structured-output chat-model call: bind the
 * per-turn Zod schema directly to the model, invoke the model with the
 * personality system prompt and the rendered context, then validate the
 * returned decision with the same schema. No agent, no tools, no provider
 * response-strategy dispatch: both OpenAI and Gemini go through this same path.
 *
 * Generation and validation happen inside the retried operation. Transient
 * provider errors are retried by the shared rate-limit/transient retry helper;
 * a decision that fails schema or semantic validation is regenerated a bounded
 * number of times. A malformed `speak` is never silently reinterpreted as a
 * valid silence.
 */
export function createRealizer(
  model: StructuredOutputChatModel,
  personality: string,
): Realizer {
  return {
    async realize(context: TurnContext, signal?: AbortSignal): Promise<RealizerDecision> {
      throwIfAborted(signal);
      const schema = buildRealizerResponseSchema(context.visibleMessages);
      const structuredModel = model.withStructuredOutput(schema);
      const messages = [
        new SystemMessage(`${personality}\n\n${REALIZER_MODE}`),
        new HumanMessage(renderRealizerContext(context)),
      ];
      return generateValidatedDecision(structuredModel, schema, messages, signal);
    },
  };
}
