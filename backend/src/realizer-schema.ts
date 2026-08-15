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
 * The closed set of motive families. Every activeDesire instantiates exactly one
 * of these; there is no "other", no generic curiosity, no conversation-process
 * category, and no boredom/stimulation category. A proposed desire that cannot
 * be cleanly explained as one of these is invalid.
 */
export const motiveSchema = z.enum([
  "wakeHomeDream",
  "gossip",
  "softPower",
  "selfProtection",
  "attachment",
  "amusement",
]);

export type Motive = z.infer<typeof motiveSchema>;

/**
 * `presentMind` is the durable first-order cognition state of the turn. It is
 * always full: `immediate` names the strongest immediate reaction, `stormwindAssociation`
 * names the cultural/story association generated from the established substrate,
 * and `integration` names what becomes most salient when both coexist. All fields
 * are required; there is no empty or "nothing arose" state.
 */
export const presentMindSchema = z.object({
  immediate: z.string().trim().min(1),
  stormwindAssociation: z.string().trim().min(1),
  integration: z.string().trim().min(1),
}).strict();

export type PresentMind = z.infer<typeof presentMindSchema>;

/**
 * `activeDesire` is always positive and concrete. `motive` selects exactly one
 * closed motive family, `strength` is "weak"/"moderate"/"strong", and `content`
 * names the concrete object. There is no "none" motive, no "none" strength, and
 * no empty state: Хевронія is never modeled as motivationally empty.
 */
export const activeDesireSchema = z.object({
  motive: motiveSchema,
  strength: z.enum(["weak", "moderate", "strong"]),
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
  realityCheck: z.string().trim().min(1),
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
