const SUBJECT_PREFIX_PATTERNS: readonly RegExp[] = [
  /^\s*the user's\s+/iu,
  /^\s*user's\s+/iu,
  /^\s*the user\s+/iu,
  /^\s*user\s+/iu,
];

/**
 * Strips legacy Mem0 subject-prefix phrasing ("User's ...", "The user ...")
 * from recalled memory text so the memory reads as a subject-relative trait of
 * the scoped dream character. Only a leading grammatical reference to the
 * scoped subject is removed; the English word "user" anywhere else in the fact
 * (for example "power user") is preserved verbatim.
 */
export function normalizeRecalledMemory(text: string): string {
  let normalized = text;
  for (const pattern of SUBJECT_PREFIX_PATTERNS) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, "");
      break;
    }
  }
  if (normalized === text || normalized.trim() === "") return text;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
