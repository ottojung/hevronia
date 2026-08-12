import { buildHandleChoices } from "./handles.js";
import type { CharacterHandle, MessageHandle } from "./handles.js";
import type { RealizerDecision, VisibleMessage } from "./realizer-schema.js";
import type {
  DeliveredHevroniaMessage,
  ObservedTelegramMessage,
  ReplyRelationship,
  TelegramSenderIdentity,
} from "./telegram-event.js";

export class UnresolvableRealizerDecisionError extends Error {
  constructor(addressCharacter: string | null, replyToMessage: string | null) {
    super(
      "Realizer speak decision references handles not present in the visible context " +
      `(addressCharacter=${addressCharacter}, replyToMessage=${replyToMessage})`,
    );
    this.name = "UnresolvableRealizerDecisionError";
  }
}

export interface ResolvedRealizerDecision {
  address: CharacterHandle | null;
  replyTo: MessageHandle | null;
}

export function resolveRealizerDecision(
  decision: Extract<RealizerDecision, { action: "speak" }>,
  candidates: readonly VisibleMessage[],
): ResolvedRealizerDecision | undefined {
  const choices = buildHandleChoices(candidates);
  let address: CharacterHandle | null = null;
  if (decision.addressCharacter !== null) {
    const found = choices.characters.find(({ handle }) => handle === decision.addressCharacter);
    if (found === undefined) return undefined;
    address = found;
  }
  let replyTo: MessageHandle | null = null;
  if (decision.replyToMessage !== null) {
    const found = choices.messages.find(({ handle }) => handle === decision.replyToMessage);
    if (found === undefined) return undefined;
    replyTo = found;
  }
  return { address, replyTo };
}

export function replyRelationshipFor(replyTo: MessageHandle | null): ReplyRelationship | null {
  if (replyTo === null) return null;
  return {
    targetMessageId: replyTo.message.messageId,
    targetSender: replyTo.message.sender,
    targetSenderDisplayName: replyTo.message.senderDisplayName,
    targetSenderUsername: replyTo.message.senderUsername,
    targetText: replyTo.message.text,
    targetIsHevronia: false,
  };
}

export function deliveredEvent(
  messageId: number,
  sender: TelegramSenderIdentity,
  text: string,
  source: ObservedTelegramMessage,
  replyTo: ReplyRelationship | null,
): DeliveredHevroniaMessage {
  return { kind: "hevronia", messageId, sender, senderDisplayName: "Хевронія",
    senderUsername: null, chatKind: source.chatKind, text,
    messageThreadId: source.messageThreadId, replyTo };
}
