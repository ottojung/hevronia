import type { ObservedTelegramMessage, TelegramSenderIdentity } from "./telegram-event.js";

export interface TelegramReplyInput {
  targetMessageId: number;
  targetSender: TelegramSenderIdentity;
  targetSenderDisplayName: string;
  targetText: string | null;
  targetsHevronia: boolean;
}

export interface TelegramObservationInput {
  messageId: number;
  sender: TelegramSenderIdentity;
  senderDisplayName: string;
  chatKind: "private" | "group" | "supergroup";
  text: string;
  messageThreadId: number | null;
  mentionsHevronia: boolean;
  replyTo: TelegramReplyInput | null;
}

export function createObservedTelegramMessage(
  input: TelegramObservationInput,
): ObservedTelegramMessage {
  return {
    kind: "participant",
    messageId: input.messageId,
    sender: input.sender,
    senderDisplayName: input.senderDisplayName,
    chatKind: input.chatKind,
    text: input.text,
    messageThreadId: input.messageThreadId,
    replyTo: input.replyTo === null ? null : {
      targetMessageId: input.replyTo.targetMessageId,
      targetSender: input.replyTo.targetSender,
      targetSenderDisplayName: input.replyTo.targetSenderDisplayName,
      targetText: input.replyTo.targetText,
    },
    directlyAddressed: input.chatKind === "private" || input.mentionsHevronia ||
      input.replyTo?.targetsHevronia === true,
  };
}

export function telegramDisplayName(firstName: string, lastName?: string): string {
  return [firstName, lastName].filter(Boolean).join(" ");
}

export function telegramSenderIdentity(
  compatibilityUserId: number,
  senderChatId?: number,
): TelegramSenderIdentity {
  return senderChatId === undefined
    ? { kind: "user", id: compatibilityUserId }
    : { kind: "chat", id: senderChatId };
}

export function hasDirectMention(
  text: string,
  entities: readonly { type: string; offset: number; length: number; user?: { id: number } }[] | undefined,
  botId: number,
  botUsername: string | undefined,
): boolean {
  return entities?.some((entity) =>
    entity.type === "text_mention" && entity.user?.id === botId ||
    entity.type === "mention" && text.slice(entity.offset, entity.offset + entity.length) === `@${botUsername}`,
  ) ?? false;
}
