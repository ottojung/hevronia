import type { ObservedTelegramMessage } from "./telegram-event.js";

export interface TelegramReplyInput {
  targetMessageId: number;
  targetSenderId: number;
  targetSenderDisplayName: string;
  targetText: string | null;
  targetsHevronia: boolean;
}

export interface TelegramObservationInput {
  messageId: number;
  senderId: number;
  senderDisplayName: string;
  chatKind: "private" | "group" | "supergroup";
  text: string;
  mentionsHevronia: boolean;
  replyTo: TelegramReplyInput | null;
}

export function createObservedTelegramMessage(
  input: TelegramObservationInput,
): ObservedTelegramMessage {
  return {
    kind: "participant",
    messageId: input.messageId,
    senderId: input.senderId,
    senderDisplayName: input.senderDisplayName,
    chatKind: input.chatKind,
    text: input.text,
    replyTo: input.replyTo === null ? null : {
      targetMessageId: input.replyTo.targetMessageId,
      targetSenderId: input.replyTo.targetSenderId,
      targetSenderDisplayName: input.replyTo.targetSenderDisplayName,
      targetText: input.replyTo.targetText,
    },
    directlyAddressed: input.chatKind === "private" || input.mentionsHevronia ||
      input.replyTo?.targetsHevronia === true,
  };
}
