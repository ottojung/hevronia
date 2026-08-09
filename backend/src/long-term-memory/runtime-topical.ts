import type { LongTermMemoryUserId } from "../identifiers.js";
import { operationalErrorDetail } from "./operations.js";
import { mergeTopical, replaceEntry, userKey } from "./runtime-cache.js";
import { enqueue } from "./runtime-queue.js";
import type { RuntimeConfig, RuntimeState } from "./runtime-types.js";

export function consumePendingTopical(
  state: RuntimeState,
  userId: LongTermMemoryUserId,
): string | undefined {
  const key = userKey(userId);
  const entry = state.cache.get(key);
  if (entry === undefined) return undefined;
  const query = entry.pendingTopicalQuery;
  state.cache.set(key, { ...entry, pendingTopicalQuery: undefined });
  return query;
}

export function topicalFinished(
  state: RuntimeState,
  config: RuntimeConfig,
  userId: LongTermMemoryUserId,
): void {
  replaceEntry(state, userId, (entry) => ({ ...entry, topicalScheduled: false }));
  const entry = state.cache.get(userKey(userId));
  if (entry !== undefined && entry.pendingTopicalQuery !== undefined) {
    scheduleTopicalSearch(state, config, userId);
  }
}

function scheduleTopicalSearch(
  state: RuntimeState,
  config: RuntimeConfig,
  userId: LongTermMemoryUserId,
): void {
  replaceEntry(state, userId, (current) => ({ ...current, topicalScheduled: true }));
  enqueue(state, config, userId, {
    userId,
    run: async () => {
      const query = consumePendingTopical(state, userId);
      if (query === undefined) {
        topicalFinished(state, config, userId);
        return;
      }
      try {
        const records = await config.store.search(userId, query, config.topicalTopK);
        mergeTopical(state, config, userId, records);
      } catch (error) {
        console.warn(`Long-term-memory topical search failed: ${operationalErrorDetail(error)}`);
      } finally {
        topicalFinished(state, config, userId);
      }
    },
  });
}

export function requestTopicalRefresh(
  state: RuntimeState,
  config: RuntimeConfig,
  userId: LongTermMemoryUserId,
  text: string,
): void {
  replaceEntry(state, userId, (entry) => ({ ...entry, pendingTopicalQuery: text }));
  const entry = state.cache.get(userKey(userId));
  if (entry !== undefined && !entry.topicalScheduled) {
    scheduleTopicalSearch(state, config, userId);
  }
}
