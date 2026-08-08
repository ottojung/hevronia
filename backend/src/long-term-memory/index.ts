import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Memory, type MemoryConfig, type MemoryItem } from "mem0ai/oss";

import { LONG_TERM_MEMORY_POLICY, MEMORY_POLICY_VERSION } from "./policy.js";
import type { ConversationThreadId, LongTermMemoryUserId } from "../identifiers.js";

export const LONG_TERM_MEMORY_TOP_K = 5;
export const MEMORY_MODEL = "gpt-4o-mini-2024-07-18";
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSION = 1536;
export const HISTORY_DB_PATH = fileURLToPath(
  new URL("../../.data/mem0/history.db", import.meta.url),
);
export const VECTOR_DB_PATH = fileURLToPath(
  new URL("../../.data/mem0/vectors-v1.db", import.meta.url),
);

export interface RecalledMemory {
  text: string;
}

export interface LongTermMemory {
  search(userId: LongTermMemoryUserId, query: string, topK: number): Promise<RecalledMemory[]>;
  rememberUserMessage(
    userId: LongTermMemoryUserId,
    threadId: ConversationThreadId,
    userMessage: string,
  ): Promise<void>;
  deleteAll(userId: LongTermMemoryUserId): Promise<void>;
}

export function createMem0Config(apiKey: string): MemoryConfig {
  return {
    llm: {
      provider: "openai",
      config: { apiKey, model: MEMORY_MODEL, temperature: 0 },
    },
    embedder: {
      provider: "openai",
      config: { apiKey, model: EMBEDDING_MODEL, embeddingDims: EMBEDDING_DIMENSION },
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

export function createMem0LongTermMemory(apiKey: string): LongTermMemory {
  mkdirSync(dirname(HISTORY_DB_PATH), { recursive: true });
  const memory = new Memory(createMem0Config(apiKey));
  console.log("Long-term memory configured using local SQLite storage");

  return {
    async search(userId, query, topK) {
      const result = await memory.search(query, {
        topK,
        filters: { user_id: userId.toPersistenceKey() },
      });
      return result.results.map((item: MemoryItem) => ({ text: item.memory }));
    },
    async rememberUserMessage(userId, threadId, userMessage) {
      await memory.add(
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
    },
    async deleteAll(userId) {
      await memory.deleteAll({ userId: userId.toPersistenceKey() });
    },
  };
}
