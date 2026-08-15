import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

import { buildHandleChoices } from "./handles.js";
import type { ParticipantMemoryContext } from "./participant-memory.js";
import {
  activeDesireSchema,
  presentMindSchema,
  realityRelationSchema,
  type RealizerDecision,
} from "./realizer-schema.js";

export interface VisibleMessage {
  messageId: number;
  sender: import("./telegram-event.js").TelegramSenderIdentity;
  senderDisplayName: string;
  senderUsername: string | null;
  text: string;
}

export interface TurnContext {
  boundedHistory: BaseMessage[];
  currentMessage: import("./telegram-event.js").ObservedTelegramMessage;
  visibleMessages: VisibleMessage[];
  participantMemories: ParticipantMemoryContext[];
  /** Persisted natural names keyed by Telegram user id. */
  naturalNames: import("./telegram-event.js").NaturalNames;
}

/**
 * Builds the schema for a specific turn so that `addressCharacter` and
 * `replyToMessage` can only take the handles of the characters and messages
 * actually visible in the context. This is the schema bound directly to the
 * chat model; it is the same Zod contract as `realizerDecisionSchema` with the
 * handle enums narrowed, so the schema that defines the structured output also
 * validates the returned result.
 */
export function buildRealizerResponseSchema(
  candidates: readonly VisibleMessage[],
): z.ZodType<RealizerDecision> {
  const choices = buildHandleChoices(candidates);
  return z.object({
    interpretation: z.string().trim().min(1),
    presentMind: presentMindSchema,
    characterIntent: z.string().trim().min(1),
    realityRelation: realityRelationSchema,
    dreamIntent: z.string().trim().min(1),
    feltState: z.string().trim().min(1),
    activeDesire: activeDesireSchema,
    desiredOutcome: z.string().trim().min(1),
    opportunity: z.string().trim().min(1),
    fiveTurnStrategy: z.string().trim().min(1),
    fiftyTurnStrategy: z.string().trim().min(1),
    action: z.enum(["speak", "silence"]),
    message: z.string().trim().nullable(),
    addressCharacter: handleChoice(choices.characters.map(({ handle }) => handle)),
    replyToMessage: handleChoice(choices.messages.map(({ handle }) => handle)),
  }).strict().superRefine((value, ctx) => {
    if (value.action === "speak") {
      if (value.message === null || value.message.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["message"],
          message: "speak requires a non-empty message",
        });
      }
    } else {
      if (value.message !== null && value.message.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["message"],
          message: "silence requires message to be null",
        });
      }
      if (value.addressCharacter !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["addressCharacter"],
          message: "silence requires addressCharacter to be null",
        });
      }
      if (value.replyToMessage !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["replyToMessage"],
          message: "silence requires replyToMessage to be null",
        });
      }
    }
  });
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
