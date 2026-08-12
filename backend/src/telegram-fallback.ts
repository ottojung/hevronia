import { conversationThreadIdFromTelegramChat, type ConversationThreadId } from "./identifiers.js";
import { deliverFallbackMessage } from "./telegram-delivery.js";
import type { DeliveredHevroniaMessage, TelegramSenderIdentity } from "./telegram-event.js";
import { telegramDisplayName, telegramSenderIdentity } from "./telegram-observation.js";

export const FALLBACK_TEXT = "Щось я зараз зависла. Спробуй ще раз за хвилину.";

export interface TelegramMessageEnvelope {
  botId: number;
  chatKind: "private" | "group" | "supergroup";
  chatId: number;
  messageId: number;
  messageThreadId: number | null;
  fromId: number;
  fromFirstName: string | undefined;
  fromLastName: string | undefined;
  fromUsername: string | null;
  senderChatId: number | undefined;
  text: string;
}

export interface FallbackSource {
  threadId: ConversationThreadId;
  messageId: number;
  botSender: TelegramSenderIdentity;
  chatKind: "private" | "group" | "supergroup";
  messageThreadId: number | null;
  targetSender: TelegramSenderIdentity;
  targetSenderDisplayName: string;
  targetSenderUsername: string | null;
  targetText: string;
}

export function fallbackSourceFor(envelope: TelegramMessageEnvelope): FallbackSource {
  return {
    threadId: conversationThreadIdFromTelegramChat(
      envelope.chatKind, envelope.chatId, envelope.messageThreadId ?? undefined,
    ),
    messageId: envelope.messageId,
    botSender: { kind: "user", id: envelope.botId },
    chatKind: envelope.chatKind,
    messageThreadId: envelope.messageThreadId,
    targetSender: telegramSenderIdentity(envelope.fromId, envelope.senderChatId),
    targetSenderDisplayName: telegramDisplayName(envelope.fromFirstName ?? "", envelope.fromLastName),
    targetSenderUsername: envelope.fromUsername,
    targetText: envelope.text,
  };
}

/**
 * Delivers and persists the fallback message. The optional `guard` runs
 * immediately before the send so a stale or cancelled reaction never sends
 * fallback; once Telegram confirms the send, the fallback is persisted
 * canonically. Failures are logged, never thrown.
 */
export function sendFallback(
  source: FallbackSource,
  sendReply: (text: string, replyToMessageId: number | null) => Promise<number>,
  recordDelivered: (threadId: ConversationThreadId, message: DeliveredHevroniaMessage) => void,
  guard: () => void = () => undefined,
): Promise<void> {
  return deliverFallbackMessage({
    text: FALLBACK_TEXT,
    sender: source.botSender,
    chatKind: source.chatKind,
    messageThreadId: source.messageThreadId,
    replyTo: {
      targetMessageId: source.messageId,
      targetSender: source.targetSender,
      targetSenderDisplayName: source.targetSenderDisplayName,
      targetSenderUsername: source.targetSenderUsername,
      targetText: source.targetText,
      targetIsHevronia: false,
    },
  }, { showTyping: async () => undefined, reply: sendReply },
    (fallback) => recordDelivered(source.threadId, fallback), guard)
    .then(() => undefined)
    .catch((fallbackError) => console.error(`Failed to deliver fallback: ${String(fallbackError)}`));
}
