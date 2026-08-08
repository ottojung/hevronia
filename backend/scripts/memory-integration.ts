import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createMem0LongTermMemory } from "../src/long-term-memory/index.js";
import { qdrantUrlFromEnv, waitForQdrantReady } from "../src/long-term-memory/qdrant.js";
import {
  conversationThreadIdFromTelegramPrivateChat,
  longTermMemoryUserIdFromIntegrationTest,
} from "../src/identifiers.js";

const userId = longTermMemoryUserIdFromIntegrationTest(randomUUID());
const threadId = conversationThreadIdFromTelegramPrivateChat(1);
const query = "улюблений фрукт";

const qdrantUrl = qdrantUrlFromEnv();
await waitForQdrantReady(qdrantUrl);
const firstMemory = createMem0LongTermMemory({ qdrantUrl });
try {
  await firstMemory.rememberUserMessage(
    userId,
    threadId,
    "Мій улюблений тестовий фрукт — манго.",
  );
  console.log("Mem0 add succeeded");

  const initialResults = await firstMemory.search(userId, query, 5);
  assert.ok(initialResults.length > 0, "Mem0 search should recall the test fact");
  console.log(`Mem0 search returned ${initialResults.length} result(s)`);

  const recreatedMemory = createMem0LongTermMemory({ qdrantUrl });
  const persistedResults = await recreatedMemory.search(userId, query, 5);
  assert.ok(persistedResults.length > 0, "memory should survive service recreation");
  console.log(`Mem0 recreation search returned ${persistedResults.length} result(s)`);

  await recreatedMemory.deleteAll(userId);
  const cleanedResults = await recreatedMemory.search(userId, query, 5);
  assert.equal(cleanedResults.length, 0, "cleanup should remove the disposable user's memories");
  console.log("Mem0 cleanup succeeded");
} finally {
  await firstMemory.deleteAll(userId).catch(() => undefined);
}
