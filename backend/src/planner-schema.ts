import { z } from "zod";

import type { CharacterHandle } from "./handles.js";
import {
  CYRILLIC_ALIAS_PATTERN,
  MAX_NATURAL_NAME_LENGTH,
  cyrillicAliasSchema,
} from "./natural-names/schema.js";
import type { ConstFreeJsonSchema } from "./realizer-schema.js";
import type { NaturalNames } from "./telegram-event.js";

export interface MissingNaturalNameChoice {
  /** Ephemeral per-turn character handle, aligned with the realizer's P-handles. */
  handle: string;
  sender: { kind: "user"; id: number };
  /** The name Telegram currently displays for this person. */
  displayName: string;
  /** The Telegram @username, if known. */
  username: string | null;
}

interface PlannerResponse {
  attention: "yes" | "no";
  naturalNames: Record<string, string | null>;
}

/**
 * The exact naming choices for a turn, derived from the same character
 * handles the realizer sees. Only visible `kind: "user"` characters without a
 * persisted natural name are eligible; channels, already-named users, stale
 * handles, and raw Telegram ids never appear. The prompt, the zod schema, the
 * provider JSON schema, and persistence all consume this single collection.
 */
export function missingNaturalNameChoices(
  characters: readonly CharacterHandle[],
  naturalNames: NaturalNames,
): MissingNaturalNameChoice[] {
  const choices: MissingNaturalNameChoice[] = [];
  for (const { handle, character } of characters) {
    if (character.sender.kind !== "user") continue;
    if (naturalNames.has(character.sender.id)) continue;
    choices.push({
      handle,
      sender: { kind: "user", id: character.sender.id },
      displayName: character.displayName,
      username: character.username,
    });
  }
  return choices;
}

/**
 * The allowed value for one unnamed person: a short Cyrillic conversational
 * alias, or `null` when no reasonable alias exists. The application decides
 * the mechanical fallback from `null` (the exact `@username`, or leaving the
 * person unnamed when there is none); the schema never receives usernames or
 * invented Latin handles.
 */
export const namingValueSchema: z.ZodType<string | null> = cyrillicAliasSchema.nullable();

/**
 * Builds the planner's expected response schema dynamically from the exact
 * per-turn naming choices: the unnamed visible user handles are the only
 * properties of `naturalNames`, every one is required, and nothing else is
 * allowed. A turn with no unnamed users yields an empty, strict `naturalNames`.
 */
export function buildPlannerResponseSchema(
  namingChoices: readonly MissingNaturalNameChoice[],
): z.ZodType<PlannerResponse> {
  const naturalNames = z.object(
    Object.fromEntries(namingChoices.map(({ handle }) => [handle, namingValueSchema])),
  ).strict();
  return z.object({
    attention: z.enum(["yes", "no"]),
    naturalNames,
  }).strict();
}

/**
 * Plain, fully inlined provider JSON Schema mirroring the zod schema: the
 * exact naming-choice handles are the only `naturalNames` properties, are all
 * required, and no other property is allowed. Each value is either a Cyrillic
 * alias or `null`.
 */
export function buildPlannerJsonSchema(
  namingChoices: readonly MissingNaturalNameChoice[],
): ConstFreeJsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      attention: { type: "string", enum: ["yes", "no"] },
      naturalNames: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          namingChoices.map(({ handle }) => [handle, namingValueJsonSchema()]),
        ),
        required: namingChoices.map(({ handle }) => handle),
      },
    },
    required: ["attention", "naturalNames"],
  };
}

function namingValueJsonSchema(): Record<string, unknown> {
  return {
    anyOf: [
      {
        type: "string",
        pattern: CYRILLIC_ALIAS_PATTERN,
        minLength: 1,
        maxLength: MAX_NATURAL_NAME_LENGTH,
      },
      { type: "null" },
    ],
  };
}

