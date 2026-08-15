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
 * competing view, and why that alternative loses. Used for analytical fields
 * where the model must discriminate between live alternatives rather than emit
 * the first plausible interpretation, motive, feeling, desire, outcome,
 * opportunity, or strategy that occurs to it.
 */
export const subjectiveJudgmentSchema = z.object({
  leading: z.string().trim().min(1),
  alternative: z.string().trim().min(1),
  whyRejected: z.string().trim().min(1),
}).strict();

export type SubjectiveJudgment = z.infer<typeof subjectiveJudgmentSchema>;

export const subjectiveJudgmentKeys: readonly string[] = ["leading", "alternative", "whyRejected"];

/**
 * `realityCheck` keeps one required leading seam, but the alternative and
 * whyRejected are optional: the model may legitimately find a single strong
 * seam and no second equally strong competitor instead of inventing a strained
 * mismatch merely to satisfy a mandatory contrastive pair.
 */
export const realityCheckSchema = z.object({
  leading: z.string().trim().min(1),
  alternative: z.string().trim().min(1).optional(),
  whyRejected: z.string().trim().min(1).optional(),
}).strict();

export type RealityCheckJudgment = z.infer<typeof realityCheckSchema>;

export const realityCheckKeys: readonly string[] = ["leading", "alternative", "whyRejected"];

/**
 * `presentMind` is the durable first-order cognition state, not an analytical
 * judgment. It records the most salient mental event that arose plus a small
 * number of additional first-order events. There is deliberately no
 * `whyRejected`: spontaneous cognition is not selected by an evidence contest,
 * and it is not action-worth. It is a compact phenomenological state.
 */
export const presentMindSchema = z.object({
  primary: z.string().trim().min(1),
  secondary: z.array(z.string().trim().min(1)).max(4),
}).strict();

export type PresentMind = z.infer<typeof presentMindSchema>;

export const presentMindKeys: readonly string[] = ["primary", "secondary"];

const decisionFields = {
  interpretation: subjectiveJudgmentSchema,
  presentMind: presentMindSchema,
  characterIntent: subjectiveJudgmentSchema,
  realityCheck: realityCheckSchema,
  dreamIntent: subjectiveJudgmentSchema,
  feltState: subjectiveJudgmentSchema,
  activeDesire: subjectiveJudgmentSchema,
  desiredOutcome: subjectiveJudgmentSchema,
  opportunity: subjectiveJudgmentSchema,
  fiveTurnStrategy: subjectiveJudgmentSchema,
  fiftyTurnStrategy: subjectiveJudgmentSchema,
};

const actionFields = {
  action: z.enum(["speak", "silence"]),
  message: z.string().trim().nullable(),
  addressCharacter: z.string().nullable(),
  replyToMessage: z.string().nullable(),
};

/**
 * The decision is one flat object whose property order follows the causal
 * order: the internal fields that determine the choice are generated before
 * `action`, and `action` is generated before the speak-only addressing and
 * message fields. The model must not choose `action` before generating the
 * internal state that is supposed to cause it.
 */
const flatDecisionSchema = z.object({
  ...decisionFields,
  ...actionFields,
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
        message: "silence requires message to be null or empty",
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

export const realizerDecisionSchema: z.ZodType<RealizerDecision> = flatDecisionSchema;

// Provider structured outputs require the root JSON Schema to be an object.
// The wrapper keeps the domain decision intact while giving the provider an
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
  const decision = z.object({
    ...decisionFields,
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
          message: "silence requires message to be null or empty",
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

export interface RealizerDecision {
  interpretation: SubjectiveJudgment;
  presentMind: PresentMind;
  characterIntent: SubjectiveJudgment;
  realityCheck: RealityCheckJudgment;
  dreamIntent: SubjectiveJudgment;
  feltState: SubjectiveJudgment;
  activeDesire: SubjectiveJudgment;
  desiredOutcome: SubjectiveJudgment;
  opportunity: SubjectiveJudgment;
  fiveTurnStrategy: SubjectiveJudgment;
  fiftyTurnStrategy: SubjectiveJudgment;
  action: "speak" | "silence";
  message: string | null;
  addressCharacter: string | null;
  replyToMessage: string | null;
}

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
