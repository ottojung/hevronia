import { z } from "zod";

/** Upper bound for a conversational natural name, in Unicode characters. */
export const MAX_NATURAL_NAME_LENGTH = 40;

/**
 * One source of truth for a natural-name value. Whitespace-only names are
 * invalid, and overlong names are rejected rather than truncated.
 */
export const naturalNameSchema = z.string().trim().min(1).max(MAX_NATURAL_NAME_LENGTH);

export type NaturalName = z.infer<typeof naturalNameSchema>;
