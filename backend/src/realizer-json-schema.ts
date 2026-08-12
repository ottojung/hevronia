import { buildHandleChoices } from "./handles.js";
import type { ConstFreeJsonSchema, VisibleMessage } from "./realizer-schema.js";

const jsonSubjectiveFields = {
  interpretation: { type: "string", minLength: 1 },
  intent: { type: "string", minLength: 1 },
  feltState: { type: "string", minLength: 1 },
  activeDesire: { type: "string", minLength: 1 },
  desiredOutcome: { type: "string", minLength: 1 },
  opportunity: { type: "string", minLength: 1 },
  pursuit: { type: "string", minLength: 1 },
};

/**
 * Builds the realizer's decision shape as a plain, fully inlined JSON Schema
 * with no `$ref` or `$defs`: every field is repeated literally in both
 * variants. OpenAI's structured-output validation rejects references that do
 * not point to top-level definitions, so inlining keeps one schema usable by
 * every provider. The zod schema (`buildRealizerResponseSchema`) remains the
 * source of truth for the typed client-side parse; these schemas only
 * constrain the generated output, so `const` is replaced with single-element
 * `enum` values.
 */
export function buildRealizerJsonSchema(
  candidates: readonly VisibleMessage[],
  strict: boolean,
): ConstFreeJsonSchema {
  const choices = buildHandleChoices(candidates);
  const objectKeywords = strict ? { additionalProperties: false } : {};
  const silenceVariant = {
    type: "object",
    ...objectKeywords,
    properties: { action: { type: "string", enum: ["silence"] }, ...jsonSubjectiveFields },
    required: ["action", "interpretation", "intent", "feltState", "activeDesire",
      "desiredOutcome", "opportunity", "pursuit"],
  };
  const speakVariant = {
    type: "object",
    ...objectKeywords,
    properties: {
      action: { type: "string", enum: ["speak"] },
      addressCharacter: handleField(choices.characters.map(({ handle }) => handle)),
      replyToMessage: handleField(choices.messages.map(({ handle }) => handle)),
      message: { type: "string", minLength: 1 },
      ...jsonSubjectiveFields,
    },
    required: ["action", "addressCharacter", "replyToMessage", "message",
      "interpretation", "intent", "feltState", "activeDesire",
      "desiredOutcome", "opportunity", "pursuit"],
  };
  return {
    type: "object",
    ...objectKeywords,
    properties: { decision: { anyOf: [silenceVariant, speakVariant] } },
    required: ["decision"],
  };
}

/**
 * Gemini's function-calling schema rejects `const` and `additionalProperties`,
 * so the non-strict variant omits the latter and uses flat `enum` values.
 */
export function buildGeminiRealizerJsonSchema(candidates: readonly VisibleMessage[]): ConstFreeJsonSchema {
  return buildRealizerJsonSchema(candidates, false);
}

/**
 * OpenAI strict structured outputs require `additionalProperties: false` on
 * every object, so the strict variant sets it while staying fully inlined.
 */
export function buildOpenAiRealizerJsonSchema(candidates: readonly VisibleMessage[]): ConstFreeJsonSchema {
  return buildRealizerJsonSchema(candidates, true);
}

function handleField(handles: readonly string[]): Record<string, unknown> {
  if (handles.length === 0) return { type: "null" };
  return { anyOf: [{ type: "string", enum: handles }, { type: "null" }] };
}
