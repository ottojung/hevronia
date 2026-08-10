import { buildPlannerChoices } from "./reply-choices.js";
import type { ReplyMessageChoice } from "./reply-choices.js";
import type {
  SocialDecision,
  SpeakDecision,
  VisibleMessage,
} from "./social-decision.js";
import type {
  DeliveredHevroniaMessage,
  ObservedTelegramMessage,
  ReplyRelationship,
  TelegramSenderIdentity,
} from "./telegram-event.js";

export function resolveSpeakDecision(
  decision: Exclude<SocialDecision, { action: "silence" }>,
  candidates: VisibleMessage[],
): SpeakDecision | undefined {
  const choices = buildPlannerChoices(candidates);
  let address: SpeakDecision["address"] = null;
  if (decision.addressCharacter !== null) {
    const found = choices.characters.find(({ handle }) => handle === decision.addressCharacter);
    if (found === undefined) return undefined;
    address = found;
  }
  let replyTo: ReplyMessageChoice | null = null;
  if (decision.replyToMessage !== null) {
    const found = choices.messages.find(({ handle }) => handle === decision.replyToMessage);
    if (found === undefined) return undefined;
    replyTo = found;
  }
  return {
    address,
    replyTo,
    subjective: {
      interpretation: decision.interpretation,
      feltState: decision.feltState,
      activeDesire: decision.activeDesire,
      desiredOutcome: decision.desiredOutcome,
      opportunity: decision.opportunity,
      pursuit: decision.pursuit,
    },
  };
}

export function replyRelationshipFor(replyTo: ReplyMessageChoice | null): ReplyRelationship | null {
  if (replyTo === null) return null;
  return {
    targetMessageId: replyTo.message.messageId,
    targetSender: replyTo.message.sender,
    targetSenderDisplayName: replyTo.message.senderDisplayName,
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
    chatKind: source.chatKind, text, messageThreadId: source.messageThreadId, replyTo };
}
