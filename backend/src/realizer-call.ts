import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { BaseMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";

import { invokeWithRateLimitRetry } from "./model-retry.js";
import { isReactionCancelledError, throwIfAborted } from "./reaction-cancelled.js";
import type { RealizerDecision } from "./realizer-schema.js";

/**
 * Bounded number of structured-output generation attempts. Transient provider
 * failures are retried by `invokeWithRateLimitRetry`; a schema/semantic
 * validation failure of the returned decision triggers a bounded regeneration
 * here. After exhaustion the error propagates and no message is sent.
 */
export const REALIZER_GENERATION_ATTEMPTS = 3;

/** The structured-output generation produced a decision that failed validation. */
export class RealizerStructuredOutputError extends Error {
  constructor(cause: unknown) {
    super("Realizer generated structured output that failed validation", { cause });
    this.name = "RealizerStructuredOutputError";
  }
}

/**
 * True when the error is a schema/semantic validation failure of the model's
 * structured output: either the model's own `withStructuredOutput` parser
 * threw a ZodError, or our post-invocation `schema.safeParse` failed.
 */
function isValidationFailure(error: unknown): boolean {
  return error instanceof RealizerStructuredOutputError || error instanceof z.ZodError;
}

/**
 * The narrow shape the realizer needs from a chat model: a direct structured
 * output bound to a per-turn Zod schema. Both `BaseChatModel` and test fakes
 * implement it; no agent, tool, or provider-strategy machinery is involved.
 * The output is `unknown` because the realizer re-parses and validates it with
 * the same schema.
 */
export interface StructuredOutputChatModel {
  withStructuredOutput(
    schema: z.ZodType<RealizerDecision>,
  ): Runnable<BaseLanguageModelInput, unknown>;
}

/**
 * Invokes the model's direct structured-output path and validates the result
 * with the same schema that defined the output. Generation and validation
 * happen inside the retried operation: transient provider errors are retried by
 * the shared rate-limit/transient retry helper, while a decision that fails
 * schema or semantic validation is regenerated a bounded number of times. A
 * malformed `speak` is never silently reinterpreted as a valid silence.
 */
export async function generateValidatedDecision(
  structuredModel: Runnable<BaseLanguageModelInput, unknown>,
  schema: z.ZodType<RealizerDecision>,
  messages: BaseMessage[],
  signal?: AbortSignal,
): Promise<RealizerDecision> {
  throwIfAborted(signal);
  let lastValidationError: RealizerStructuredOutputError | undefined;
  for (let attempt = 1; attempt <= REALIZER_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const decision = await invokeWithRateLimitRetry(async () => {
        try {
          const result = await structuredModel.invoke(messages, { signal });
          return schema.parse(result);
        } catch (error) {
          if (isValidationFailure(error)) {
            throw new RealizerStructuredOutputError(error);
          }
          throw error;
        }
      }, { signal });
      return decision;
    } catch (error) {
      if (signal !== undefined && (signal.aborted || isReactionCancelledError(error))) {
        throw error;
      }
      if (error instanceof RealizerStructuredOutputError) {
        lastValidationError = error;
        if (attempt < REALIZER_GENERATION_ATTEMPTS) {
          console.warn(
            `Realizer structured output failed validation; regenerating ` +
              `(attempt ${attempt}/${REALIZER_GENERATION_ATTEMPTS})`,
          );
          throwIfAborted(signal);
          continue;
        }
        throw error;
      }
      throw error;
    }
  }
  throw lastValidationError ?? new Error("Realizer exhausted generation attempts");
}
