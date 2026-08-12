import { buildHandleChoices } from "./handles.js";
import { subjectiveJudgmentKeys, type ConstFreeJsonSchema, type VisibleMessage } from "./realizer-schema.js";

function subjectiveJudgmentJson(additionalProperties: boolean): Record<string, unknown> {
  return {
    type: "object",
    ...(additionalProperties ? { additionalProperties: false } : {}),
    properties: Object.fromEntries(
      subjectiveJudgmentKeys.map((key) => [key, { type: "string", minLength: 1 }]),
    ),
    required: [...subjectiveJudgmentKeys],
  };
}

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
  const subjectiveFields = {
    interpretation: subjectiveJudgmentJson(strict),
    characterIntent: subjectiveJudgmentJson(strict),
    realityCheck: subjectiveJudgmentJson(strict),
    dreamIntent: subjectiveJudgmentJson(strict),
    feltState: subjectiveJudgmentJson(strict),
    activeDesire: subjectiveJudgmentJson(strict),
    desiredOutcome: subjectiveJudgmentJson(strict),
    opportunity: subjectiveJudgmentJson(strict),
    fiveTurnStrategy: subjectiveJudgmentJson(strict),
    fiftyTurnStrategy: subjectiveJudgmentJson(strict),
  };
  const silenceVariant = {
    type: "object",
    ...objectKeywords,
    properties: { action: { type: "string", enum: ["silence"] }, ...subjectiveFields },
    required: ["action", "interpretation", "characterIntent", "realityCheck", "dreamIntent",
      "feltState", "activeDesire", "desiredOutcome", "opportunity", "fiveTurnStrategy",
      "fiftyTurnStrategy"],
  };
  const speakVariant = {
    type: "object",
    ...objectKeywords,
    properties: {
      action: { type: "string", enum: ["speak"] },
      addressCharacter: handleField(choices.characters.map(({ handle }) => handle)),
      replyToMessage: handleField(choices.messages.map(({ handle }) => handle)),
      message: { type: "string", minLength: 1 },
      ...subjectiveFields,
    },
    required: ["action", "addressCharacter", "replyToMessage", "message",
      "interpretation", "characterIntent", "realityCheck", "dreamIntent", "feltState",
      "activeDesire", "desiredOutcome", "opportunity", "fiveTurnStrategy",
      "fiftyTurnStrategy"],
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
