import type { ConversationThreadId, LongTermMemoryUserId } from "../identifiers.js";
import type { MemoryRecord } from "./index.js";
import { operationalErrorDetail } from "./operations.js";
import {
  clearBaselinePending,
  ensureEntry,
  mergeBaseline,
  mergeLearned,
  replaceEntry,
  userKey,
} from "./runtime-cache.js";
import { enqueue } from "./runtime-queue.js";
import { requestTopicalRefresh } from "./runtime-topical.js";
import type { RuntimeConfig, RuntimeState } from "./runtime-types.js";
import { MEMORY_WARM_QUERY } from "./runtime-types.js";

export function scheduleWarm(
  state: RuntimeState,
  config: RuntimeConfig,
  userId: LongTermMemoryUserId,
): void {
  const entry = ensureEntry(state, config, userId);
  if (entry.baselinePending) return;
  if (entry.baselineLoadedAt !== undefined && config.now() - entry.baselineLoadedAt < config.warmTtlMs) {
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
  const key = userKey(userId);
  const threadKey = threadId.toPersistenceKey();
  let byThread = state.pendingIngestion.get(key);
  if (byThread === undefined) {
    byThread = new Map();
    state.pendingIngestion.set(key, byThread);
  }
  const pending = byThread.get(threadKey);
  if (pending !== undefined) {
    // A same-user/same-thread ingestion job is already queued and has not
    // started; coalesce into it without enqueuing another job.
    pending.push(text);
    return;
  }
  byThread.set(threadKey, [text]);
  enqueue(state, config, userId, {
    userId,
    run: async () => {
      const batch = byThread.get(threadKey) ?? [];
      byThread.delete(threadKey);
      if (byThread.size === 0) state.pendingIngestion.delete(key);
      try {
        const records: MemoryRecord[] =
          await config.store.rememberUserMessages(userId, threadId, batch);
        mergeLearned(state, config, userId, records);
      } catch (error) {
        console.warn(`Long-term-memory ingestion failed: ${operationalErrorDetail(error)}`);
      } finally {
        // Topical search reflects the newest message in the coalesced batch.
        requestTopicalRefresh(state, config, userId, batch[batch.length - 1] ?? "");
      }
    },
  });
}
