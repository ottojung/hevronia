import { notebookSubject } from "./telegram-event.js";
import type { TelegramSenderIdentity } from "./telegram-event.js";
import type { VisibleMessage } from "./social-decision.js";

export interface DreamCharacter {
  sender: TelegramSenderIdentity;
  /** Stable dream label, e.g. "character 42" or "channel 500". */
  subject: string;
  /** The name Telegram currently displays for this character. */
  displayName: string;
}

export interface AddressChoice {
  /** Mechanical planner handle, e.g. "P1". Never shown to the realizer. */
  handle: string;
  character: DreamCharacter;
}

export interface ReplyMessageChoice {
  /** Mechanical planner handle, e.g. "M1". Never shown to the realizer. */
  handle: string;
  message: VisibleMessage;
}

export interface PlannerChoices {
  characters: AddressChoice[];
  messages: ReplyMessageChoice[];
  /** messageId → message handle, for annotating rendered history entries. */
  messageAnnotations: ReadonlyMap<number, string>;
}

export function buildPlannerChoices(candidates: readonly VisibleMessage[]): PlannerChoices {
  const seen = new Map<string, VisibleMessage>();
  for (const candidate of candidates) {
    const key = `${candidate.sender.kind}:${candidate.sender.id}`;
    if (!seen.has(key)) seen.set(key, candidate);
  }
  const characters: AddressChoice[] = [...seen.values()].map((candidate, index) => ({
    handle: plannerHandle("P", index),
    character: {
      sender: candidate.sender,
      subject: notebookSubject(candidate.sender),
      displayName: candidate.senderDisplayName,
    },
  }));
  const messages: ReplyMessageChoice[] = candidates.map((message, index) => ({
    handle: plannerHandle("M", index),
    message,
  }));
  const messageAnnotations = new Map(
    messages.map(({ handle, message }) => [message.messageId, handle]),
  );
  return { characters, messages, messageAnnotations };
}

function plannerHandle(prefix: "P" | "M", index: number): string {
  return `${prefix}${index + 1}`;
}
