/**
 * The properties that this class carries are:
 * - The value is a canonical LangGraph persisted thread key in either the
 *   `telegram-private:` or `telegram-group:` namespace.
 * - The value originated from a positive, safe-integer Telegram private-chat
 *   identifier, or a negative safe-integer Telegram group-chat identifier,
 *   optionally scoped to a positive message-thread/topic identifier.
 *
 * The proof of those properties is guaranteed by:
 * - This class can only be introduced through these functions:
 *   - `conversationThreadIdFromTelegramPrivateChat(...)`: validates that the
 *     Telegram chat identifier is a positive safe integer and prefixes its
 *     decimal representation with `telegram-private:`.
 *   - `conversationThreadIdFromTelegramGroupChat(...)`: validates that the
 *     Telegram chat identifier is a negative safe integer and prefixes its
 *     decimal representation with `telegram-group:`.
 */
class ConversationThreadIdValue {
  constructor(private readonly persistenceKey: string) {}

  toPersistenceKey(): string {
    return this.persistenceKey;
  }
}

export type ConversationThreadId = ConversationThreadIdValue;

/**
 * The properties that this class carries are:
 * - The value is a canonical Mem0 persisted user key.
 * - Telegram users use the `telegram-user:` namespace and originate from a
 *   positive, safe-integer Telegram sender identifier.
 * - Disposable integration users use the `integration-test:` namespace and
 *   originate from a canonical UUID.
 *
 * The proof of those properties is guaranteed by:
 * - This class can only be introduced through these functions:
 *   - `longTermMemoryUserIdFromTelegramSender(...)`: validates that the sender
 *     identifier is a positive safe integer and adds `telegram-user:`.
 *   - `longTermMemoryUserIdFromIntegrationTest(...)`: validates a canonical
 *     UUID and adds `integration-test:` for isolated live verification.
 */
class LongTermMemoryUserIdValue {
  constructor(private readonly persistenceKey: string) {}

  toPersistenceKey(): string {
    return this.persistenceKey;
  }
}

export type LongTermMemoryUserId = LongTermMemoryUserIdValue;

export class InvalidTelegramIdentifierError extends Error {
  constructor(kind: string, requirement = "a positive safe integer") {
    super(`Telegram ${kind} identifier must be ${requirement}`);
    this.name = "InvalidTelegramIdentifierError";
  }
}

export class InvalidIntegrationTestIdentifierError extends Error {
  constructor() {
    super("Integration-test memory identifier must be a canonical UUID");
    this.name = "InvalidIntegrationTestIdentifierError";
  }
}

export function isInvalidTelegramIdentifierError(
  error: unknown,
): error is InvalidTelegramIdentifierError {
  return error instanceof InvalidTelegramIdentifierError;
}

export function isInvalidIntegrationTestIdentifierError(
  error: unknown,
): error is InvalidIntegrationTestIdentifierError {
  return error instanceof InvalidIntegrationTestIdentifierError;
}

export function conversationThreadIdFromTelegramPrivateChat(
  chatId: number,
  messageThreadId?: number,
): ConversationThreadId {
  validateTelegramIdentifier(chatId, "private chat");
  return new ConversationThreadIdValue(withTopic(`telegram-private:${chatId}`, messageThreadId));
}

export function conversationThreadIdFromTelegramGroupChat(
  chatId: number,
  messageThreadId?: number,
): ConversationThreadId {
  if (!Number.isSafeInteger(chatId) || chatId >= 0) {
    throw new InvalidTelegramIdentifierError("group chat", "a negative safe integer");
  }
  return new ConversationThreadIdValue(withTopic(`telegram-group:${chatId}`, messageThreadId));
}

export function conversationThreadIdFromTelegramChat(
  chatKind: "private" | "group" | "supergroup",
  chatId: number,
  messageThreadId?: number,
): ConversationThreadId {
  return chatKind === "private"
    ? conversationThreadIdFromTelegramPrivateChat(chatId, messageThreadId)
    : conversationThreadIdFromTelegramGroupChat(chatId, messageThreadId);
}

export function longTermMemoryUserIdFromTelegramSender(senderId: number): LongTermMemoryUserId {
  validateTelegramIdentifier(senderId, "sender");
  return new LongTermMemoryUserIdValue(`telegram-user:${senderId}`);
}

export function longTermMemoryUserIdFromIntegrationTest(
  identifier: string,
): LongTermMemoryUserId {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(identifier)) {
    throw new InvalidIntegrationTestIdentifierError();
  }
  return new LongTermMemoryUserIdValue(`integration-test:${identifier}`);
}

function validateTelegramIdentifier(identifier: number, kind: string): void {
  if (!Number.isSafeInteger(identifier) || identifier <= 0) {
    throw new InvalidTelegramIdentifierError(kind);
  }
}

function withTopic(base: string, messageThreadId: number | undefined): string {
  if (messageThreadId === undefined) return base;
  validateTelegramIdentifier(messageThreadId, "message thread");
  return `${base}:topic:${messageThreadId}`;
}
