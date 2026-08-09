import { notebookSubject } from "./telegram-event.js";
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

export function renderReplyChoices(candidates: readonly ReplyCandidate[]): string {
  if (candidates.length === 0) {
    return "There are no Telegram messages you could reply to directly right now.";
  }
  const choices = replyChoices(candidates).map(({ label, candidate }) => [
    `Reply choice ${label}:`,
    `${notebookSubject(candidate.sender)}, displayed as “${candidate.senderDisplayName}”`,
    "Visible message:",
    candidate.text,
  ].join("\n"));
  return `Messages you could reply to directly:\n\n${choices.join("\n\n")}`;
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
