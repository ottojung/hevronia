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
 * Gemini's function-calling schema rejects `const` and deep `anyOf` trees, so
 * this builds the same decision shape as a plain JSON Schema that uses flat
 * `enum` values instead: the action discriminator and the visible P/M handles.
 * The zod schema remains the source of truth for the typed client-side parse.
 */
export function buildGeminiRealizerJsonSchema(
  candidates: readonly VisibleMessage[],
): ConstFreeJsonSchema {
  const choices = buildHandleChoices(candidates);
  const silenceVariant = {
    type: "object",
    properties: { action: { type: "string", enum: ["silence"] }, ...jsonSubjectiveFields },
    required: ["action", "interpretation", "intent", "feltState", "activeDesire",
      "desiredOutcome", "opportunity", "pursuit"],
  };
  const speakVariant = {
    type: "object",
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
    properties: { decision: { anyOf: [silenceVariant, speakVariant] } },
    required: ["decision"],
  };
}

function handleField(handles: readonly string[]): Record<string, unknown> {
  if (handles.length === 0) return { type: "null" };
  return { anyOf: [{ type: "string", enum: handles }, { type: "null" }] };
}
