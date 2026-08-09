import { notebookSubject } from "./telegram-event.js";
import type { DeliveredHevroniaMessage, ReplyRelationship, TelegramSenderIdentity } from "./telegram-event.js";

export function renderOwnMessage(event: DeliveredHevroniaMessage): string {
  if (event.replyTo === null) {
    return `Earlier, you chose to make this Telegram message appear:\n\n${event.text}`;
  }
  const target = event.replyTo;
  const reference = displayReference(target.targetSender, target.targetSenderDisplayName);
  if (target.targetText !== null) {
    return [
      `Earlier, you chose to make this Telegram message appear as a reply to an earlier message from ${reference}:`,
      "",
      target.targetText,
      "",
      "Your reply was:",
      "",
      event.text,
    ].join("\n");
  }
  return [
    `Earlier, you chose to make this Telegram message appear as a reply to something that appeared through ${reference}.`,
    "",
    event.text,
  ].join("\n");
}

export function renderReplyRelationship(relationship: ReplyRelationship): string {
  if (relationship.targetSenderDisplayName === "Хевронія") {
    const head = "Telegram visually connects this message as a reply to one of your own earlier messages:";
    return relationship.targetText === null
      ? head.replace(/:$/, ".")
      : `${head}\n${relationship.targetText}`;
  }
  const subject = notebookSubject(relationship.targetSender);
  const head = `Telegram visually connects this message as a reply to an earlier message that appeared through “${subject}”, currently displayed as “${relationship.targetSenderDisplayName}”:`;
  return relationship.targetText === null
    ? head.replace(/:$/, ".")
    : `${head}\n${relationship.targetText}`;
}

function displayReference(sender: TelegramSenderIdentity, displayName: string): string {
  return sender.kind === "user"
    ? `the character Telegram displayed as “${displayName}”`
    : `the source Telegram displayed as “${displayName}”`;
}
