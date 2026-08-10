import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

import type { ParticipantMemoryContext } from "./participant-memory.js";

export const socialDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("silence") }).strict(),
  z.object({
    action: z.literal("speak"),
    addressCharacter: z.string().nullable(),
    replyToMessage: z.string().nullable(),
    interpretation: z.string().min(1),
    feltState: z.string().min(1),
    activeDesire: z.string().min(1),
    desiredOutcome: z.string().min(1),
    opportunity: z.string().min(1),
    pursuit: z.string().min(1),
  }).strict(),
]);

export type SocialDecision = z.infer<typeof socialDecisionSchema>;

// Provider structured outputs require the root JSON Schema to be an object.
// A top-level discriminated union serializes to `anyOf`, which OpenAI rejects.
// The wrapper keeps the domain union intact while giving the provider an
// object root; callers stay on `SocialDecision` via the unwrapped domain schema.
export const socialDecisionResponseSchema = z.object({
  decision: socialDecisionSchema,
}).strict();

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
