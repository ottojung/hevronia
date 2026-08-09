import { ensureEntry, project, userKey } from "./runtime-cache.js";
import { evictIfNeeded } from "./runtime-eviction.js";
import { drain, pump } from "./runtime-queue.js";
import { scheduleIngestion, scheduleWarm } from "./runtime-scheduling.js";
import { scheduleTopical } from "./runtime-topical.js";
import {
  MEMORY_BACKGROUND_CONCURRENCY,
  MEMORY_BACKGROUND_IDLE_DELAY_MS,
  MEMORY_CONTEXT_LIMIT,
  MEMORY_LEARNED_LIMIT,
  MEMORY_MAX_CACHED_USERS,
  MEMORY_SHUTDOWN_DRAIN_TIMEOUT_MS,
  MEMORY_TOPICAL_TOP_K,
  MEMORY_WARM_TOP_K,
  MEMORY_WARM_TTL_MS,
  type LazyLongTermMemory,
  type LazyLongTermMemoryOptions,
  type RuntimeConfig,
  type RuntimeState,
  type Scheduler,
} from "./runtime-types.js";

export * from "./runtime-types.js";

const defaultScheduler: Scheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

export function createLazyLongTermMemory(options: LazyLongTermMemoryOptions): LazyLongTermMemory {
  const config: RuntimeConfig = {
    store: options.store,
    now: options.now ?? Date.now,
    scheduler: options.scheduler ?? defaultScheduler,
    warmTopK: options.warmTopK ?? MEMORY_WARM_TOP_K,
    warmTtlMs: options.warmTtlMs ?? MEMORY_WARM_TTL_MS,
    topicalTopK: options.topicalTopK ?? MEMORY_TOPICAL_TOP_K,
    learnedLimit: options.learnedLimit ?? MEMORY_LEARNED_LIMIT,
    contextLimit: options.contextLimit ?? MEMORY_CONTEXT_LIMIT,
    maxCachedUsers: options.maxCachedUsers ?? MEMORY_MAX_CACHED_USERS,
    concurrency: options.backgroundConcurrency ?? MEMORY_BACKGROUND_CONCURRENCY,
    idleDelayMs: options.idleDelayMs ?? MEMORY_BACKGROUND_IDLE_DELAY_MS,
    shutdownDrainTimeoutMs: options.shutdownDrainTimeoutMs ?? MEMORY_SHUTDOWN_DRAIN_TIMEOUT_MS,
  };
  const state: RuntimeState = {
    cache: new Map(),
    queuedByUser: new Map(),
    queue: [],
    foregroundCount: 0,
    running: 0,
    closed: false,
    idleTimer: undefined,
    idleWaiters: [],
    inFlight: new Set(),
  };
  return {
    beginTurn() {
      state.foregroundCount += 1;
      const snapshotCache = new Map(state.cache);
      let released = false;
      return {
        snapshot: {
          memoriesFor(userId) {
            return project(config, snapshotCache.get(userKey(userId)));
          },
        },
        release() {
          if (released) return;
          released = true;
          if (state.foregroundCount > 0) state.foregroundCount -= 1;
          if (state.foregroundCount === 0) pump(state, config);
        },
      };
    },
    warmUser(userId) {
      ensureEntry(state, config, userId);
      scheduleWarm(state, config, userId);
      evictIfNeeded(state, config);
    },
    observeUserMessage(userId, threadId, text) {
      ensureEntry(state, config, userId);
      scheduleWarm(state, config, userId);
      scheduleTopical(state, config, userId, text);
      scheduleIngestion(state, config, userId, threadId, text);
      evictIfNeeded(state, config);
    },
    async close() {
      if (state.closed) return;
      state.closed = true;
      if (state.idleTimer !== undefined) {
        state.idleTimer();
        state.idleTimer = undefined;
      }
      pump(state, config);
      await drain(state, config);
    },
  };
}
