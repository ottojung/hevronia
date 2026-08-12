import { dreamSubject, type NaturalNames } from "./telegram-event.js";
import type { DeliveredHevroniaMessage, ObservedTelegramMessage } from "./telegram-event.js";

const EMPTY_NAMES: NaturalNames = new Map();

export function renderOwnMessage(
  event: DeliveredHevroniaMessage,
  naturalNames: NaturalNames = EMPTY_NAMES,
): string {
  if (event.replyTo === null) {
    return `You previously chose to make this Telegram message appear:\n\n${event.text}`;
  }
  const subject = dreamSubject(event.replyTo.targetSender, naturalNames);
  const target = event.replyTo.targetSender.kind === "user"
    ? subject
    : `the Telegram source ${subject}`;
  return `You previously chose to reply to ${target} with:\n\n${event.text}`;
}

export function renderParticipantMessage(
  event: ObservedTelegramMessage,
  naturalNames: NaturalNames = EMPTY_NAMES,
): string {
  const subject = dreamSubject(event.sender, naturalNames);
  const speaker = event.sender.kind === "user"
    ? subject
    : `the Telegram source ${subject}`;
  let head: string;
  if (event.replyTo === null) {
    head = `Your sleeping mind made ${speaker} say:`;
  } else if (event.replyTo.targetIsHevronia) {
    head = `Your sleeping mind made ${speaker} reply to one of your earlier messages with:`;
  } else {
    const targetSubject = dreamSubject(event.replyTo.targetSender, naturalNames);
    const target = event.replyTo.targetSender.kind === "user"
      ? targetSubject
      : `the Telegram source ${targetSubject}`;
    head = `Your sleeping mind made ${speaker} reply to ${target} with:`;
  }
  const directness = event.replyTo !== null && event.replyTo.targetIsHevronia
    // The reply wording already says the message came back to Хевронія.
    ? ""
    : event.directlyAddressed
      ? "\n\nThis message was addressed to you directly."
      : "";
  return `${head}\n\n${event.text}${directness}`;
}
