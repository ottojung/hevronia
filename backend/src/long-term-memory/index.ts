import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Memory, type MemoryConfig } from "mem0ai/oss";

import { cheapModelFromEnv, openAiTemperature, providerForModelName } from "../model.js";
import { LONG_TERM_MEMORY_POLICY, MEMORY_POLICY_VERSION } from "./policy.js";
import type { ConversationThreadId, LongTermMemoryUserId } from "../identifiers.js";
import { memoryRecordsFromItems, type MemoryRecord } from "./store-mapping.js";

export { memoryRecordsFromItems } from "./store-mapping.js";
export type { MemoryRecord } from "./store-mapping.js";

export const MEMORY_MODEL = cheapModelFromEnv();
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSION = 1536;
export const HISTORY_DB_PATH = fileURLToPath(
  new URL("../../.data/mem0/history.db", import.meta.url),
);
export const VECTOR_DB_PATH = fileURLToPath(
  new URL("../../.data/mem0/vectors-v1.db", import.meta.url),
);

export interface LongTermMemoryStore {
  search(
    userId: LongTermMemoryUserId,
    query: string,
    topK: number,
  ): Promise<MemoryRecord[]>;

  rememberUserMessage(
    userId: LongTermMemoryUserId,
    threadId: ConversationThreadId,
    userMessage: string,
  ): Promise<MemoryRecord[]>;

  deleteAll(userId: LongTermMemoryUserId): Promise<void>;
}

export function createMem0Config(
  openAiApiKey: string,
  geminiApiKey: string,
  model: string = MEMORY_MODEL,
): MemoryConfig {
  const memoryProvider = providerForModelName(model);
  const provider = memoryProvider === "gemini" ? "google" : "openai";
  const llmConfig = memoryProvider === "gemini"
    ? { apiKey: geminiApiKey, model, temperature: 0 }
    : { apiKey: openAiApiKey, model, ...openAiTemperature(0) };
  return {
    llm: {
      // Extraction runs on the cheap model (MEMORY_MODEL), but on the
      // provider that owns that model: a non-Gemini cheap tier must not be
      // sent to the Google provider. Embeddings stay on OpenAI.
      provider,
      config: llmConfig,
    },
    embedder: {
      provider: "openai",
      config: { apiKey: openAiApiKey, model: EMBEDDING_MODEL, embeddingDims: EMBEDDING_DIMENSION },
    },
    vectorStore: {
      // Mem0's "memory" vector-store provider is backed by persistent SQLite
      // when dbPath is supplied.
      provider: "memory",
      config: {
        dbPath: VECTOR_DB_PATH,
        dimension: EMBEDDING_DIMENSION,
      },
    },
    historyDbPath: HISTORY_DB_PATH,
    customInstructions: LONG_TERM_MEMORY_POLICY,
  };
}

export type Mem0Client = Pick<Memory, "search" | "add" | "deleteAll">;

export function longTermMemoryStoreFromMem0(memory: Mem0Client): LongTermMemoryStore {
  return {
    async search(userId, query, topK) {
      const result = await memory.search(query, {
        topK,
        filters: { user_id: userId.toPersistenceKey() },
      });
      return memoryRecordsFromItems(result.results);
    },
    async rememberUserMessage(userId, threadId, userMessage) {
      const result = await memory.add(
        [{ role: "user", content: userMessage }],
        {
          userId: userId.toPersistenceKey(),
          metadata: {
            source: "telegram",
            threadId: threadId.toPersistenceKey(),
            memoryPolicyVersion: MEMORY_POLICY_VERSION,
          },
        },
      );
      return memoryRecordsFromItems(result.results);
    },
    async deleteAll(userId) {
      await memory.deleteAll({ userId: userId.toPersistenceKey() });
    },
  };
}

export function createMem0Store(openAiApiKey: string, geminiApiKey: string): LongTermMemoryStore {
  mkdirSync(dirname(HISTORY_DB_PATH), { recursive: true });
  const memory = new Memory(createMem0Config(openAiApiKey, geminiApiKey));
  console.log("Long-term memory configured using local SQLite storage");
  return longTermMemoryStoreFromMem0(memory);
}
