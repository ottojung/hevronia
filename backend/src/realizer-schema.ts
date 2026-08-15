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
 * always full: `immediate` names the direct first-order reaction to the current
 * event, `culturalThought` names a concrete thought arising from the remembered
 * Warcraft-world substrate (which need not relate to the current event at all),
 * and `foreground` names which thought is actually in the foreground now. All
 * fields are required; there is no empty or "nothing arose" state.
 */
export const presentMindSchema = z.object({
  immediate: z.string().trim().min(1),
  culturalThought: z.string().trim().min(1),
  foreground: z.string().trim().min(1),
}).strict();

export type PresentMind = z.infer<typeof presentMindSchema>;

/**
 * `activeDesire` is always positive and concrete. `motive` selects exactly one
 * closed motive family, `strength` is "weak"/"moderate"/"strong", `content`
 * names the concrete object, and `basis` names the concrete admission fact that
 * shows why this desire genuinely belongs to its motive family. There is no
 * "none" motive, no "none" strength, and no empty state: Хевронія is never
 * modeled as motivationally empty. When the motive is amusement, strength must
 * be moderate or strong: the amusement threshold is high, and a weak amusement
 * does not admit the motive.
 */
export const activeDesireSchema = z.object({
  motive: motiveSchema,
  strength: z.enum(["weak", "moderate", "strong"]),
  content: z.string().trim().min(1),
  basis: z.string().trim().min(1),
}).strict().superRefine((value, ctx) => {
  if (value.motive === "amusement" && value.strength === "weak") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["strength"],
      message: "amusement requires strength moderate or strong",
    });
  }
});

export type ActiveDesire = z.infer<typeof activeDesireSchema>;

/**
 * `realityRelation` names how the dream-world event relates to remembered
 * reality: a grounded world-to-world difference, a close correspondence, or a
 * distortion where something recognizable from reality appears flattened,
 * gamified, displaced, or simplified. It is always positive — there is no
 * "none" value and the model is never required to manufacture a mismatch.
 */
export const realityRelationSchema = z.object({
  kind: z.enum(["difference", "correspondence", "distortion"]),
  content: z.string().trim().min(1),
}).strict();

export type RealityRelation = z.infer<typeof realityRelationSchema>;

/**
 * Every field is required. Nullable execution fields are always present; `null`
 * is the required value meaning "no address / no reply / no message". There
 * are no optional or omitted properties anywhere in the decision.
 */
export const realizerDecisionObjectSchema = z.object({
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
