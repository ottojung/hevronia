import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

import { buildHandleChoices } from "./handles.js";
import type { ParticipantMemoryContext } from "./participant-memory.js";

export interface ConstFreeJsonSchema {
  type: "null" | "boolean" | "object" | "array" | "number" | "string" | "integer";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * A contrastive subjective judgment: the leading view, the strongest genuinely
 * competing view, and why the leading view currently wins. All three parts are
 * mandatory so the realizer discriminates between live alternatives instead of
 * emitting the first plausible interpretation, motive, feeling, desire,
 * outcome, opportunity, or action that occurs to it.
 */
export const subjectiveJudgmentSchema = z.object({
  leading: z.string().trim().min(1),
  alternative: z.string().trim().min(1),
  whyLeading: z.string().trim().min(1),
}).strict();

export type SubjectiveJudgment = z.infer<typeof subjectiveJudgmentSchema>;

export const subjectiveJudgmentKeys: readonly string[] = ["leading", "alternative", "whyLeading"];

const subjectiveFields = {
  interpretation: subjectiveJudgmentSchema,
  intent: subjectiveJudgmentSchema,
  feltState: subjectiveJudgmentSchema,
  activeDesire: subjectiveJudgmentSchema,
  desiredOutcome: subjectiveJudgmentSchema,
  opportunity: subjectiveJudgmentSchema,
  pursuit: subjectiveJudgmentSchema,
};

const silenceVariant = z.object({
  action: z.literal("silence"),
  ...subjectiveFields,
}).strict();

const speakFields = {
  ...subjectiveFields,
  message: z.string().trim().min(1),
};

const speakVariant = z.object({
  action: z.literal("speak"),
  addressCharacter: z.string().nullable(),
  replyToMessage: z.string().nullable(),
  ...speakFields,
}).strict();

export const realizerDecisionSchema = z.discriminatedUnion("action", [
  silenceVariant,
  speakVariant,
]);

// Provider structured outputs require the root JSON Schema to be an object.
// The wrapper keeps the domain union intact while giving the provider an
// object root; callers stay on `RealizerDecision` via the unwrapped schema.
export const realizerResponseSchema = z.object({
  decision: realizerDecisionSchema,
}).strict();

/**
 * Builds the response schema for a specific turn so that `addressCharacter`
 * and `replyToMessage` can only take the handles of the characters and
 * messages actually visible in the context. The provider enforces the enum in
 * strict mode; the client-side parse enforces it even when the provider does
 * not, so the model cannot emit a raw id, a display name, or free text.
 */
export function buildRealizerResponseSchema(
  candidates: readonly VisibleMessage[],
): z.ZodType<{ decision: RealizerDecision }> {
  const choices = buildHandleChoices(candidates);
  const speak = z.object({
    action: z.literal("speak"),
    addressCharacter: handleChoice(choices.characters.map(({ handle }) => handle)),
    replyToMessage: handleChoice(choices.messages.map(({ handle }) => handle)),
    ...speakFields,
  }).strict();
  return z.object({ decision: z.discriminatedUnion("action", [silenceVariant, speak]) }).strict();
}

function handleChoice(handles: readonly string[]): z.ZodType<string | null> {
  const head = handles[0];
  if (head === undefined) return z.null();
  let schema: z.ZodType<string> = z.literal(head);
  for (const handle of handles.slice(1)) {
    schema = schema.or(z.literal(handle));
  }
  return schema.nullable();
}

export type RealizerDecision = z.infer<typeof realizerDecisionSchema>;

export interface VisibleMessage {
  messageId: number;
  sender: import("./telegram-event.js").TelegramSenderIdentity;
  senderDisplayName: string;
  text: string;
}

export interface TurnContext {
  boundedHistory: BaseMessage[];
  currentMessage: import("./telegram-event.js").ObservedTelegramMessage;
  visibleMessages: VisibleMessage[];
  participantMemories: ParticipantMemoryContext[];
}
