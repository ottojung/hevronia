import { buildPlannerChoices } from "./reply-choices.js";
import type { VisibleMessage } from "./social-decision-schema.js";

export interface ConstFreeJsonSchema {
  type: "null" | "boolean" | "object" | "array" | "number" | "string" | "integer";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

const subjectiveFields = {
  interpretation: { type: "string", minLength: 1 },
  feltState: { type: "string", minLength: 1 },
  activeDesire: { type: "string", minLength: 1 },
  desiredOutcome: { type: "string", minLength: 1 },
  opportunity: { type: "string", minLength: 1 },
  pursuit: { type: "string", minLength: 1 },
};

/**
 * Gemini's function-calling schema rejects `const` and deep `anyOf` trees, so
 * this builds the same decision shape as a plain JSON Schema that uses flat
 * `enum` values instead: the action discriminator and the visible P/M handles.
 * The zod schema remains the source of truth for the typed client-side parse.
 */
export function buildGeminiSocialDecisionJsonSchema(
  candidates: readonly VisibleMessage[],
): ConstFreeJsonSchema {
  const choices = buildPlannerChoices(candidates);
  const silenceVariant = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["silence"] },
      ...subjectiveFields,
    },
    required: [
      "action", "interpretation", "feltState", "activeDesire", "desiredOutcome",
      "opportunity", "pursuit",
    ],
  };
  const speakVariant = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["speak"] },
      addressCharacter: handleField(choices.characters.map(({ handle }) => handle)),
      replyToMessage: handleField(choices.messages.map(({ handle }) => handle)),
      ...subjectiveFields,
    },
    required: [
      "action", "addressCharacter", "replyToMessage", "interpretation",
      "feltState", "activeDesire", "desiredOutcome", "opportunity", "pursuit",
    ],
  };
  return {
    type: "object",
    properties: {
      decision: { anyOf: [silenceVariant, speakVariant] },
    },
    required: ["decision"],
  };
}

function handleField(handles: readonly string[]): Record<string, unknown> {
  if (handles.length === 0) return { type: "null" };
  return { anyOf: [{ type: "string", enum: handles }, { type: "null" }] };
}
