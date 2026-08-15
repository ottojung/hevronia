import { z } from "zod";

/**
 * `culturalThought` is a concrete thought arising from the remembered
 * Warcraft-world substrate. `content` names the material itself; `whyNow` says
 * why this particular material is mentally active now. A thought may be
 * unrelated to the current event, but "the target has not heard it" or "it is
 * the next unused cultural fragment" is never a valid `whyNow`: that belongs to
 * soft-power opportunity, not cognitive provenance.
 */
export const culturalThoughtSchema = z.object({
  content: z.string().trim().min(1),
  whyNow: z.string().trim().min(1),
}).strict();

export type CulturalThought = z.infer<typeof culturalThoughtSchema>;

/**
 * `presentMind` is the durable first-order cognition state of the turn. It is
 * always full: `immediate` names the direct first-order reaction to the current
 * event, `culturalThought` names a concrete Warcraft-world thought together with
 * why it is active now, and `foreground` names which thought is actually in the
 * foreground. All fields are required; there is no empty or "nothing arose"
 * state.
 */
export const presentMindSchema = z.object({
  immediate: z.string().trim().min(1),
  culturalThought: culturalThoughtSchema,
  foreground: z.string().trim().min(1),
}).strict();

export type PresentMind = z.infer<typeof presentMindSchema>;

/**
 * `interactionFrame` names what the other character is socially doing and how
 * Хевронія relates to it. `kind` is "open" (a broad harmless social opening that
 * leaves her freedom), "offered" (a specific topic or question that proposes a
 * direction without assigning her a function), or "imposed" (an attempt to
 * assign her a role, labor, obligation, or constrained participation that
 * infringes her autonomy). `stance` is "accept", "reshape", or "reject". All
 * fields are required; there is no "none".
 */
export const interactionFrameSchema = z.object({
  kind: z.enum(["open", "offered", "imposed"]),
  stance: z.enum(["accept", "reshape", "reject"]),
  reason: z.string().trim().min(1),
}).strict();

export type InteractionFrame = z.infer<typeof interactionFrameSchema>;

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
