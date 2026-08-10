import { notebookSubject } from "./telegram-event.js";
import type { DeliveredHevroniaMessage, ObservedTelegramMessage } from "./telegram-event.js";

export function renderOwnMessage(event: DeliveredHevroniaMessage): string {
  if (event.replyTo === null) {
    return `You previously chose to make this Telegram message appear:\n\n${event.text}`;
  }
  const subject = notebookSubject(event.replyTo.targetSender);
  const target = event.replyTo.targetSender.kind === "user"
    ? subject
    : `the Telegram source ${subject}`;
  return `You previously chose to reply to ${target} with:\n\n${event.text}`;
}

export function renderParticipantMessage(event: ObservedTelegramMessage): string {
  const subject = notebookSubject(event.sender);
  const speaker = event.sender.kind === "user"
    ? subject
    : `the Telegram source ${subject}`;
  let head: string;
  if (event.replyTo === null) {
    head = `Your sleeping mind made ${speaker} say:`;
  } else if (event.replyTo.targetIsHevronia) {
    head = `Your sleeping mind made ${speaker} reply to one of your earlier messages with:`;
  } else {
    const targetSubject = notebookSubject(event.replyTo.targetSender);
    const target = event.replyTo.targetSender.kind === "user"
      ? targetSubject
      : `the Telegram source ${targetSubject}`;
    head = `Your sleeping mind made ${speaker} reply to ${target} with:`;
  }
  return `${head}\n\n${event.text}`;
}
