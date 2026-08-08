import type { ObservedTelegramMessage } from "./telegram-event.js";

export interface TelegramReplyInput {
  messageId: number;
  senderId: number;
  senderDisplayName: string;
  isHevronia: boolean;
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
      messageId: input.replyTo.messageId,
      senderId: input.replyTo.senderId,
      senderDisplayName: input.replyTo.senderDisplayName,
      isHevronia: input.replyTo.isHevronia,
    },
    directlyAddressed: input.chatKind === "private" || input.mentionsHevronia ||
      input.replyTo?.isHevronia === true,
  };
}
