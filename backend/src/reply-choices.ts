import type { ReplyCandidate } from "./social-decision.js";

export interface ReplyChoice {
  label: string;
  candidate: ReplyCandidate;
}

/**
 * Ephemeral per-turn reply handles. Each eligible candidate gets a letter for
 * this planner invocation only; the letters are never persisted, never used as
 * identities, and never shown to the realization model.
 */
export function replyChoices(candidates: readonly ReplyCandidate[]): ReplyChoice[] {
  return candidates.map((candidate, index) => ({
    label: replyChoiceLabel(index),
    candidate,
  }));
}

function replyChoiceLabel(index: number): string {
  let label = "";
  let value = index;
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}
