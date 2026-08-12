import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import {
  createMem0Store,
  VECTOR_DB_PATH,
} from "../src/long-term-memory/index.js";
import { geminiKeyFromEnv, openAiKeyFromEnv } from "../src/model.js";
import {
  conversationThreadIdFromTelegramPrivateChat,
  longTermMemoryUserIdFromIntegrationTest,
} from "../src/identifiers.js";

const userId = longTermMemoryUserIdFromIntegrationTest(randomUUID());
const threadId = conversationThreadIdFromTelegramPrivateChat(1);
const query = "улюблений фрукт";
const openAiApiKey = openAiKeyFromEnv();
const geminiApiKey = geminiKeyFromEnv();

const firstMemory = createMem0Store(openAiApiKey, geminiApiKey);
try {
  await firstMemory.rememberUserMessages(
    userId,
    threadId,
    ["Мій улюблений тестовий фрукт — манго."],
  );
  console.log("Mem0 add succeeded");

  const initialResults = await firstMemory.search(userId, query, 5);
  assert.ok(initialResults.length > 0, "Mem0 search should recall the test fact");
  assert.ok(existsSync(VECTOR_DB_PATH), "Mem0 should create the SQLite vector database");
  console.log(`Mem0 search returned ${initialResults.length} result(s)`);
  assert.ok(initialResults.every(({ id }) => typeof id === "string" && id.length > 0),
    "search results should retain the persistent memory id");
  assert.ok(initialResults.every(({ text }) => typeof text === "string" && text.length > 0),
    "search results should retain memory text");

  const recreatedMemory = createMem0Store(openAiApiKey, geminiApiKey);
  const persistedResults = await recreatedMemory.search(userId, query, 5);
  assert.ok(persistedResults.length > 0, "memory should survive Memory instance recreation");
  console.log(`Mem0 recreation search returned ${persistedResults.length} result(s)`);

  await recreatedMemory.deleteAll(userId);
  const cleanedResults = await recreatedMemory.search(userId, query, 5);
  assert.equal(cleanedResults.length, 0, "cleanup should remove the disposable user's memories");
  console.log("Mem0 cleanup succeeded");
} finally {
  await firstMemory.deleteAll(userId).catch(() => undefined);
}
