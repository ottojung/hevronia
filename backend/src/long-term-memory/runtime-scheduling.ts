import type { ConversationThreadId, LongTermMemoryUserId } from "../identifiers.js";
import type { MemoryRecord } from "./index.js";
import { operationalErrorDetail } from "./operations.js";
import {
  clearBaselinePending,
  ensureEntry,
  mergeBaseline,
  mergeLearned,
  replaceEntry,
} from "./runtime-cache.js";
import { enqueue } from "./runtime-queue.js";
import type { RuntimeConfig, RuntimeState } from "./runtime-types.js";
import { MEMORY_WARM_QUERY } from "./runtime-types.js";

export function scheduleWarm(
  state: RuntimeState,
  config: RuntimeConfig,
  userId: LongTermMemoryUserId,
): void {
  const entry = ensureEntry(state, config, userId);
  if (entry.baselinePending) return;
  if (entry.baselineLoadedAt !== 0 && config.now() - entry.baselineLoadedAt < config.warmTtlMs) {
    return;
  }
  replaceEntry(state, userId, (current) => ({ ...current, baselinePending: true }));
  enqueue(state, config, userId, {
    userId,
    run: async () => {
      try {
        const records = await config.store.search(userId, MEMORY_WARM_QUERY, config.warmTopK);
        mergeBaseline(state, config, userId, records);
      } finally {
        clearBaselinePending(state, userId);
      }
    },
  });
}

export function scheduleIngestion(
  state: RuntimeState,
  config: RuntimeConfig,
  userId: LongTermMemoryUserId,
  threadId: ConversationThreadId,
  text: string,
): void {
  enqueue(state, config, userId, {
    userId,
    run: async () => {
      try {
        const records: MemoryRecord[] = await config.store.rememberUserMessage(userId, threadId, text);
        mergeLearned(state, config, userId, records);
      } catch (error) {
        console.warn(`Long-term-memory ingestion failed: ${operationalErrorDetail(error)}`);
      }
    },
  });
}
