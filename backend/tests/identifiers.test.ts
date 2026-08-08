import assert from "node:assert/strict";
import { test } from "node:test";

import {
  conversationThreadIdFromTelegramPrivateChat,
  isInvalidIntegrationTestIdentifierError,
  isInvalidTelegramIdentifierError,
  longTermMemoryUserIdFromIntegrationTest,
  longTermMemoryUserIdFromTelegramSender,
} from "../src/identifiers.js";

test("Telegram identifiers construct distinct canonical persistence namespaces", () => {
  const threadId = conversationThreadIdFromTelegramPrivateChat(123);
  const userId = longTermMemoryUserIdFromTelegramSender(123);
  assert.equal(threadId.toPersistenceKey(), "telegram-private:123");
  assert.equal(userId.toPersistenceKey(), "telegram-user:123");
});

test("Telegram identifier factories reject invalid persisted identifiers", () => {
  assert.throws(
    () => conversationThreadIdFromTelegramPrivateChat(0),
    isInvalidTelegramIdentifierError,
  );
  assert.throws(
    () => longTermMemoryUserIdFromTelegramSender(Number.NaN),
    isInvalidTelegramIdentifierError,
  );
});

test("integration memory users require and preserve a canonical UUID", () => {
  const identifier = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(
    longTermMemoryUserIdFromIntegrationTest(identifier).toPersistenceKey(),
    `integration-test:${identifier}`,
  );
  assert.throws(
    () => longTermMemoryUserIdFromIntegrationTest("not-a-uuid"),
    isInvalidIntegrationTestIdentifierError,
  );
});
