import { notebookSubject } from "./telegram-event.js";
import type { TelegramSenderIdentity } from "./telegram-event.js";
import type { VisibleMessage } from "./realizer-schema.js";

export interface DreamCharacter {
  sender: TelegramSenderIdentity;
  /** Stable dream label, e.g. "character 42" or "channel 500". */
  subject: string;
  /** The name Telegram currently displays for this character. */
  displayName: string;
}

export interface CharacterHandle {
  /** Ephemeral per-turn handle, e.g. "P1". Chosen by the smart realizer. */
  handle: string;
  character: DreamCharacter;
}

export interface MessageHandle {
  /** Ephemeral per-turn handle, e.g. "M1". Chosen by the smart realizer. */
  handle: string;
  message: VisibleMessage;
}

export interface RealizerChoices {
  characters: CharacterHandle[];
  messages: MessageHandle[];
  /** messageId → message handle, for annotating rendered history entries. */
  messageAnnotations: ReadonlyMap<number, string>;
}

export function buildHandleChoices(candidates: readonly VisibleMessage[]): RealizerChoices {
  const seen = new Map<string, VisibleMessage>();
  for (const candidate of candidates) {
    const key = `${candidate.sender.kind}:${candidate.sender.id}`;
    if (!seen.has(key)) seen.set(key, candidate);
  }
  const characters: CharacterHandle[] = [...seen.values()].map((candidate, index) => ({
    handle: handleFor("P", index),
    character: {
      sender: candidate.sender,
      subject: notebookSubject(candidate.sender),
      displayName: candidate.senderDisplayName,
    },
  }));
  const messages: MessageHandle[] = candidates.map((message, index) => ({
    handle: handleFor("M", index),
    message,
  }));
  const messageAnnotations = new Map(
    messages.map(({ handle, message }) => [message.messageId, handle]),
  );
  return { characters, messages, messageAnnotations };
}

function handleFor(prefix: "P" | "M", index: number): string {
  return `${prefix}${index + 1}`;
}
