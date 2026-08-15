import { z } from "zod";

/** Shared plain JSON-Schema shape used by the planner's hand-built schema. */
export interface ConstFreeJsonSchema {
  type: "null" | "boolean" | "object" | "array" | "number" | "string" | "integer";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * `presentMind` is the durable first-order cognition state: the most salient
 * mental event that arose plus a bounded list of additional first-order events.
 * Every field is required; `secondary` may be an empty array. There is
 * deliberately no contrastive `whyRejected` machinery: spontaneous cognition is
 * not selected by an evidence contest.
 */
export const presentMindSchema = z.object({
  primary: z.string().trim().min(1),
  secondary: z.array(z.string().trim().min(1)).max(4),
}).strict();

export type PresentMind = z.infer<typeof presentMindSchema>;

/**
 * `realityCheck` explicitly distinguishes a real world-to-world mismatch from
 * no meaningful mismatch. Both fields are always required: when no grounded
 * seam exists, `status` is "none" and `content` states that plainly. The model
 * is never required to invent a seam to satisfy the schema.
 */
export const realityCheckSchema = z.object({
  status: z.enum(["seam", "none"]),
  content: z.string().trim().min(1),
}).strict();

export type RealityCheck = z.infer<typeof realityCheckSchema>;

/**
 * `activeDesire` distinguishes a real weak desire from the absence of a want.
 * `strength` is always present: "none" means genuinely no unsatisfied want
 * exists, while "weak"/"moderate"/"strong" mean a real desire exists. A weak
 * desire is still a desire; enactment-worth is decided by `action`, never by
 * rewriting the desire into "none".
 */
export const activeDesireSchema = z.object({
  strength: z.enum(["none", "weak", "moderate", "strong"]),
  content: z.string().trim().min(1),
}).strict();

export type ActiveDesire = z.infer<typeof activeDesireSchema>;

/**
 * Every field is required. Nullable execution fields are always present; `null`
 * is the required value meaning "no address / no reply / no message". There
 * are no optional or omitted properties anywhere in the decision.
 */
export const realizerDecisionObjectSchema = z.object({
  interpretation: z.string().trim().min(1),
  presentMind: presentMindSchema,
  characterIntent: z.string().trim().min(1),
  realityCheck: realityCheckSchema,
  dreamIntent: z.string().trim().min(1),
  feltState: z.string().trim().min(1),
  activeDesire: activeDesireSchema,
  desiredOutcome: z.string().trim().min(1),
  opportunity: z.string().trim().min(1),
  fiveTurnStrategy: z.string().trim().min(1),
  fiftyTurnStrategy: z.string().trim().min(1),
  action: z.enum(["speak", "silence"]),
  message: z.string().trim().nullable(),
  addressCharacter: z.string().nullable(),
  replyToMessage: z.string().nullable(),
}).strict();

export const realizerDecisionSchema = realizerDecisionObjectSchema.superRefine((value, ctx) => {
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

export type RealizerDecision = z.infer<typeof realizerDecisionSchema>;

