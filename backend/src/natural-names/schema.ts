import { z } from "zod";

/** Upper bound for a conversational natural name, in Unicode characters. */
export const MAX_NATURAL_NAME_LENGTH = 40;

/**
 * One source of truth for a natural-name value. Whitespace-only names are
 * invalid, and overlong names are rejected rather than truncated.
 */
export const naturalNameSchema = z.string().trim().min(1).max(MAX_NATURAL_NAME_LENGTH);

/**
 * The only characters a short Cyrillic conversational alias may use: Cyrillic
 * letters (Ukrainian and Belarusian/Russian extras included), optionally
 * separated by a space, hyphen, or apostrophe. No Latin letters, digits,
 * handle decoration, or invented non-name tokens.
 */
export const CYRILLIC_ALIAS_PATTERN =
  "^[А-Яа-яЁёІіЇїЄєҐґ]+(?:[\\s'’-][А-Яа-яЁёІіЇїЄєҐґ]+)*$";

/**
 * A short Cyrillic conversational name such as «Боб», «Супербоб», «Анна», or
 * «Аня». This is the only invented-form value the planner may produce; an
 * opaque username with no obvious Cyrillic rendering must instead be kept as
 * its exact `@username`.
 */
export const cyrillicAliasSchema = z.string()
  .trim()
  .min(1)
  .max(MAX_NATURAL_NAME_LENGTH)
  .regex(new RegExp(CYRILLIC_ALIAS_PATTERN));

export type NaturalName = z.infer<typeof naturalNameSchema>;
