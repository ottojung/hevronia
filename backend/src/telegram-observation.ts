import type { ObservedTelegramMessage, TelegramSenderIdentity } from "./telegram-event.js";

export interface TelegramReplyInput {
  targetMessageId: number;
  targetSender: TelegramSenderIdentity;
  targetSenderDisplayName: string;
  targetSenderUsername: string | null;
  targetText: string | null;
  targetsHevronia: boolean;
}

export interface TelegramObservationInput {
  messageId: number;
  sender: TelegramSenderIdentity;
  senderDisplayName: string;
  senderUsername: string | null;
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
    senderUsername: input.senderUsername,
    chatKind: input.chatKind,
    text: input.text,
    messageThreadId: input.messageThreadId,
    replyTo: input.replyTo === null ? null : {
      targetMessageId: input.replyTo.targetMessageId,
      targetSender: input.replyTo.targetSender,
      targetSenderDisplayName: input.replyTo.targetSenderDisplayName,
      targetSenderUsername: input.replyTo.targetSenderUsername,
      targetText: input.replyTo.targetText,
      targetIsHevronia: input.replyTo.targetsHevronia,
    },
    directlyAddressed: input.chatKind === "private" || input.mentionsHevronia ||
      input.replyTo?.targetsHevronia === true,
  };
}

export function telegramDisplayName(firstName: string, lastName?: string): string {
  return [firstName, lastName].filter(Boolean).join(" ");
}

export function telegramSenderIdentity(
  senderUserId: number,
  senderChatId?: number,
): TelegramSenderIdentity {
  return senderChatId === undefined
    ? { kind: "user", id: senderUserId }
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
