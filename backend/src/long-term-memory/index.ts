import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Memory, type MemoryConfig, type MemoryItem } from "mem0ai/oss";

import { MODEL, openAiKeyFromEnv } from "../model.js";
import { LONG_TERM_MEMORY_POLICY, MEMORY_POLICY_VERSION } from "./policy.js";

export const LONG_TERM_MEMORY_TOP_K = 5;
export const MEMORY_MODEL = MODEL;
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSION = 1536;
export const QDRANT_COLLECTION = "hevronia-long-term-memory-v1";
export const MEM0_DIRECTORY = fileURLToPath(new URL("../../.data/mem0/", import.meta.url));
export const QDRANT_PATH = fileURLToPath(new URL("../../.data/mem0/qdrant/", import.meta.url));
export const HISTORY_DB_PATH = fileURLToPath(
  new URL("../../.data/mem0/history.db", import.meta.url),
);

export interface RecalledMemory {
  text: string;
}

export interface LongTermMemory {
  search(userId: string, query: string, topK: number): Promise<RecalledMemory[]>;
  rememberTurn(
    userId: string,
    threadId: string,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void>;
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
      provider: "qdrant",
      config: {
        collectionName: QDRANT_COLLECTION,
        dimension: EMBEDDING_DIMENSION,
        path: QDRANT_PATH,
        onDisk: true,
      },
    },
    historyDbPath: HISTORY_DB_PATH,
    customInstructions: LONG_TERM_MEMORY_POLICY,
  };
}

export function createMem0LongTermMemory(): LongTermMemory {
  mkdirSync(QDRANT_PATH, { recursive: true });
  const memory = new Memory(createMem0Config(openAiKeyFromEnv()));
  console.log(`Long-term memory initialized; local data directory: ${MEM0_DIRECTORY}`);

  return {
    async search(userId, query, topK) {
      const result = await memory.search(query, {
        topK,
        filters: { user_id: userId },
      });
      return result.results.map((item: MemoryItem) => ({ text: item.memory }));
    },
    async rememberTurn(userId, threadId, userMessage, assistantMessage) {
      await memory.add(
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: assistantMessage },
        ],
        {
          userId,
          metadata: {
            source: "telegram",
            threadId,
            memoryPolicyVersion: MEMORY_POLICY_VERSION,
          },
        },
      );
    },
  };
}
