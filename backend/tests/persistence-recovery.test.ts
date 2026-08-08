import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ConversationThreadPersistenceError,
  PendingConversationWrites,
  TerminalConversationWriteError,
  isConversationThreadPersistenceError,
} from "../src/pending-conversation-writes.js";
import { conversationThreadIdFromTelegramPrivateChat } from "../src/identifiers.js";

test("terminal canonical failure rejects later operations and bounded drain completes", async () => {
  const writes = new PendingConversationWrites(3, 1);
  const threadId = conversationThreadIdFromTelegramPrivateChat(90);
  let attempts = 0;
  await assert.rejects(() => writes.submitAndWait(threadId, async () => {
    attempts += 1;
    throw new TerminalConversationWriteError("invalid canonical event");
  }), isConversationThreadPersistenceError);
  assert.equal(attempts, 1);
  await assert.rejects(() => writes.waitForThread(threadId),
    (error) => error instanceof ConversationThreadPersistenceError &&
      error.threadKey === "telegram-private:90");
  let laterWriteRan = false;
  await assert.rejects(() => writes.submitAndWait(threadId, async () => {
    laterWriteRan = true;
  }), isConversationThreadPersistenceError);
  assert.equal(laterWriteRan, false);
  await writes.drain();
});

test("retry exhaustion becomes an explicit terminal thread state", async () => {
  const writes = new PendingConversationWrites(2, 1);
  const threadId = conversationThreadIdFromTelegramPrivateChat(91);
  let attempts = 0;
  await assert.rejects(() => writes.submitAndWait(threadId, async () => {
    attempts += 1;
    throw new Error("persistent SQLite failure");
  }), isConversationThreadPersistenceError);
  assert.equal(attempts, 2);
  await writes.drain();
});
