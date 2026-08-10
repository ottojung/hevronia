import { buildPlannerChoices } from "./reply-choices.js";
import type { VisibleMessage } from "./social-decision.js";

export interface PlannerFailureReport {
  error: unknown;
  messageText: string;
  requestedAddressCharacter: string | null;
  requestedReplyToMessage: string | null;
  validCharacterHandles: string[];
  validMessageHandles: string[];
}

export function describePlannerFailure(
  error: unknown,
  messageText: string,
  candidates: readonly VisibleMessage[],
  requested: { addressCharacter: string | null; replyToMessage: string | null },
): PlannerFailureReport {
  const choices = buildPlannerChoices(candidates);
  return {
    error,
    messageText,
    requestedAddressCharacter: requested.addressCharacter,
    requestedReplyToMessage: requested.replyToMessage,
    validCharacterHandles: choices.characters.map(({ handle, character }) =>
      `${handle} = ${character.subject} (${character.displayName})`),
    validMessageHandles: choices.messages.map(({ handle, message }) =>
      `${handle} = message ${message.messageId} from ${message.senderDisplayName}`),
  };
}

export function formatPlannerFailure(report: PlannerFailureReport): string {
  const detail = report.error instanceof Error
    ? `${report.error.name}: ${report.error.message}`
    : String(report.error);
  const requested =
    report.requestedAddressCharacter !== null || report.requestedReplyToMessage !== null
      ? `addressCharacter=${report.requestedAddressCharacter}, ` +
        `replyToMessage=${report.requestedReplyToMessage}`
      : null;
  const characters = report.validCharacterHandles.length === 0
    ? "(none)"
    : report.validCharacterHandles.join(", ");
  const messages = report.validMessageHandles.length === 0
    ? "(none)"
    : report.validMessageHandles.join(", ");
  const lines = [
    "Planner decision failed; the turn fell back to silence",
    `  on message: ${report.messageText.replaceAll(/\s+/gu, " ").trim()}`,
    `  error: ${detail}`,
  ];
  if (requested !== null) lines.push(`  requested: ${requested}`);
  lines.push(`  valid character handles: ${characters}`);
  lines.push(`  valid message handles: ${messages}`);
  return lines.join("\n");
}

export function reportPlannerFailure(
  onPlannerError: ((rendered: string) => void) | undefined,
  error: unknown,
  messageText: string,
  candidates: readonly VisibleMessage[],
  requested: { addressCharacter: string | null; replyToMessage: string | null },
): void {
  const rendered = formatPlannerFailure(
    describePlannerFailure(error, messageText, candidates, requested),
  );
  if (onPlannerError !== undefined) {
    onPlannerError(rendered);
  } else {
    console.error(rendered);
  }
}
