import {
  dreamSubject,
  notebookSubject,
  type NaturalNames,
  type TelegramSenderIdentity,
} from "./telegram-event.js";
import type { VisibleMessage } from "./realizer-response-schema.js";

export interface DreamCharacter {
  sender: TelegramSenderIdentity;
  /** Dream label the models address, e.g. "Боб", "character 42", "channel 500". */
  subject: string;
  /** The stable notebook identity, e.g. "character 42" or "channel 500". */
  notebook: string;
  /** The name Telegram currently displays for this character. */
  displayName: string;
  /** The Telegram @username, if known. */
  username: string | null;
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

export function buildHandleChoices(
  candidates: readonly VisibleMessage[],
  naturalNames: NaturalNames = new Map(),
): RealizerChoices {
  // Handle ordering follows first appearance, but the Telegram display name
  // and username come from the latest visible message for each sender, so the
  // planner and realizer never act on stale metadata.
  const firstSeen = new Map<string, VisibleMessage>();
  const latest = new Map<string, VisibleMessage>();
  for (const candidate of candidates) {
    const key = senderKey(candidate.sender);
    if (!firstSeen.has(key)) firstSeen.set(key, candidate);
    latest.set(key, candidate);
  }
  const characters: CharacterHandle[] = [...firstSeen.entries()].map(([key, candidate], index) => {
    const meta = latest.get(key) ?? candidate;
    return {
      handle: handleFor("P", index),
      character: {
        sender: candidate.sender,
        subject: dreamSubject(candidate.sender, naturalNames),
        notebook: notebookSubject(candidate.sender),
        displayName: meta.senderDisplayName,
        username: meta.senderUsername ?? null,
      },
    };
  });
  const messages: MessageHandle[] = candidates.map((message, index) => ({
    handle: handleFor("M", index),
    message,
  }));
  const messageAnnotations = new Map(
    messages.map(({ handle, message }) => [message.messageId, handle]),
  );
  return { characters, messages, messageAnnotations };
}

function senderKey(sender: TelegramSenderIdentity): string {
  return `${sender.kind}:${sender.id}`;
}

function handleFor(prefix: "P" | "M", index: number): string {
  return `${prefix}${index + 1}`;
}
