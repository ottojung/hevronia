/**
 * The properties that this class carries are:
 * - The value is a canonical LangGraph persisted thread key in either the
 *   `telegram-private:` or `telegram-group:` namespace.
 * - The value originated from a positive, safe-integer Telegram private-chat
 *   identifier, or a negative safe-integer Telegram group-chat identifier.
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
 * - The value is a canonical Mem0/Qdrant persisted user key.
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
): ConversationThreadId {
  validateTelegramIdentifier(chatId, "private chat");
  return new ConversationThreadIdValue(`telegram-private:${chatId}`);
}

export function conversationThreadIdFromTelegramGroupChat(chatId: number): ConversationThreadId {
  if (!Number.isSafeInteger(chatId) || chatId >= 0) {
    throw new InvalidTelegramIdentifierError("group chat", "a negative safe integer");
  }
  return new ConversationThreadIdValue(`telegram-group:${chatId}`);
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
