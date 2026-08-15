import { buildHandleChoices } from "./handles.js";
import {
  presentMindKeys,
  realityCheckKeys,
  subjectiveJudgmentKeys,
  type ConstFreeJsonSchema,
  type VisibleMessage,
} from "./realizer-schema.js";

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

function realityCheckJson(additionalProperties: boolean): Record<string, unknown> {
  return {
    type: "object",
    ...(additionalProperties ? { additionalProperties: false } : {}),
    properties: Object.fromEntries(
      realityCheckKeys.map((key) => [key, { type: "string", minLength: 1 }]),
    ),
    required: ["leading"],
  };
}

function presentMindJson(additionalProperties: boolean): Record<string, unknown> {
  return {
    type: "object",
    ...(additionalProperties ? { additionalProperties: false } : {}),
    properties: {
      primary: { type: "string", minLength: 1 },
      secondary: { type: "array", items: { type: "string", minLength: 1 } },
    },
    required: [...presentMindKeys],
  };
}

/**
 * Builds the realizer's decision shape as a plain, fully inlined JSON Schema
 * with no `$ref` or `$defs`: every field is repeated literally. OpenAI's
 * structured-output validation rejects references that do not point to
 * top-level definitions, so inlining keeps one schema usable by every provider.
 * The zod schema (`buildRealizerResponseSchema`) remains the source of truth
 * for the typed client-side parse; these schemas only constrain the generated
 * output, so `const` is replaced with single-element `enum` values.
 *
 * The property order follows the causal order of generation: the internal
 * fields (interpretation, presentMind, characterIntent, realityCheck,
 * dreamIntent, feltState, activeDesire, desiredOutcome, opportunity,
 * fiveTurnStrategy, fiftyTurnStrategy) come before `action`, and `action`
 * comes before the speak-only addressing and message fields. The model must
 * generate the state that determines the choice before it chooses the action.
 */
export function buildRealizerJsonSchema(
  candidates: readonly VisibleMessage[],
  strict: boolean,
): ConstFreeJsonSchema {
  const choices = buildHandleChoices(candidates);
  const objectKeywords = strict ? { additionalProperties: false } : {};
  const decisionFields = {
    interpretation: subjectiveJudgmentJson(strict),
    presentMind: presentMindJson(strict),
    characterIntent: subjectiveJudgmentJson(strict),
    realityCheck: realityCheckJson(strict),
    dreamIntent: subjectiveJudgmentJson(strict),
    feltState: subjectiveJudgmentJson(strict),
    activeDesire: subjectiveJudgmentJson(strict),
    desiredOutcome: subjectiveJudgmentJson(strict),
    opportunity: subjectiveJudgmentJson(strict),
    fiveTurnStrategy: subjectiveJudgmentJson(strict),
    fiftyTurnStrategy: subjectiveJudgmentJson(strict),
    action: { type: "string", enum: ["speak", "silence"] },
    message: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    addressCharacter: handleField(choices.characters.map(({ handle }) => handle)),
    replyToMessage: handleField(choices.messages.map(({ handle }) => handle)),
  };
  return {
    type: "object",
    ...objectKeywords,
    properties: {
      decision: {
        type: "object",
        ...objectKeywords,
        properties: decisionFields,
        required: [
          "interpretation", "presentMind", "characterIntent", "realityCheck",
          "dreamIntent", "feltState", "activeDesire", "desiredOutcome", "opportunity",
          "fiveTurnStrategy", "fiftyTurnStrategy", "action", "message",
          "addressCharacter", "replyToMessage",
        ],
      },
    },
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
