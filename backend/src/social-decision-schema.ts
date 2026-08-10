import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

import { buildPlannerChoices } from "./reply-choices.js";
import type { ParticipantMemoryContext } from "./participant-memory.js";

const silenceVariant = z.object({
  action: z.literal("silence"),
  interpretation: z.string().min(1),
  feltState: z.string().min(1),
  activeDesire: z.string().min(1),
  desiredOutcome: z.string().min(1),
  opportunity: z.string().min(1),
  pursuit: z.string().min(1),
}).strict();

const speakFields = {
  interpretation: z.string().min(1),
  feltState: z.string().min(1),
  activeDesire: z.string().min(1),
  desiredOutcome: z.string().min(1),
  opportunity: z.string().min(1),
  pursuit: z.string().min(1),
};

export const socialDecisionSchema = z.discriminatedUnion("action", [
  silenceVariant,
  z.object({
    action: z.literal("speak"),
    addressCharacter: z.string().nullable(),
    replyToMessage: z.string().nullable(),
    ...speakFields,
  }).strict(),
]);

// Provider structured outputs require the root JSON Schema to be an object.
// A top-level discriminated union serializes to `anyOf`, which OpenAI rejects.
// The wrapper keeps the domain union intact while giving the provider an
// object root; callers stay on `SocialDecision` via the unwrapped domain schema.
export const socialDecisionResponseSchema = z.object({
  decision: socialDecisionSchema,
}).strict();

/**
 * Builds the response schema for a specific turn so that `addressCharacter`
 * and `replyToMessage` can only take the planner handles of the characters and
 * messages actually visible in the context. The provider enforces the enum in
 * strict mode; the client-side parse enforces it even when the provider does
 * not, so the model cannot emit a raw id, a display name, or free text.
 */
export function buildSocialDecisionResponseSchema(
  candidates: readonly VisibleMessage[],
): z.ZodType<{ decision: SocialDecision }> {
  const choices = buildPlannerChoices(candidates);
  const decision = z.discriminatedUnion("action", [
    silenceVariant,
    z.object({
      action: z.literal("speak"),
      addressCharacter: handleChoice(choices.characters.map(({ handle }) => handle)),
      replyToMessage: handleChoice(choices.messages.map(({ handle }) => handle)),
      ...speakFields,
    }).strict(),
  ]);
  return z.object({ decision }).strict();
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

export type SocialDecision = z.infer<typeof socialDecisionSchema>;

export interface VisibleMessage {
  messageId: number;
  sender: import("./telegram-event.js").TelegramSenderIdentity;
  senderDisplayName: string;
  text: string;
}

export interface SocialDecisionContext {
  boundedHistory: BaseMessage[];
  currentMessage: import("./telegram-event.js").ObservedTelegramMessage;
  visibleMessages: VisibleMessage[];
  participantMemories: ParticipantMemoryContext[];
}

export interface SocialDecisionMaker {
  decide(context: SocialDecisionContext): Promise<SocialDecision>;
}
