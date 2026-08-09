import type { ConversationThreadId, LongTermMemoryUserId } from "../identifiers.js";
import type { LongTermMemoryStore, MemoryRecord } from "./index.js";

export interface RecalledMemory {
  text: string;
}

export interface LongTermMemorySnapshot {
  memoriesFor(userId: LongTermMemoryUserId): readonly RecalledMemory[];
}

export interface LongTermMemoryTurn {
  readonly snapshot: LongTermMemorySnapshot;
  release(): void;
}

export interface LazyLongTermMemory {
  beginTurn(): LongTermMemoryTurn;
  warmUser(userId: LongTermMemoryUserId): void;
  observeUserMessage(
    userId: LongTermMemoryUserId,
    threadId: ConversationThreadId,
    text: string,
  ): void;
  close(): Promise<void>;
}

export interface Scheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface LazyLongTermMemoryOptions {
  store: LongTermMemoryStore;
  now?: () => number;
  scheduler?: Scheduler;
  warmTopK?: number;
  warmTtlMs?: number;
  topicalTopK?: number;
  learnedLimit?: number;
  contextLimit?: number;
  maxCachedUsers?: number;
  backgroundConcurrency?: number;
  idleDelayMs?: number;
  shutdownDrainTimeoutMs?: number;
}

export const MEMORY_BACKGROUND_CONCURRENCY = 1;
export const MEMORY_BACKGROUND_IDLE_DELAY_MS = 100;
export const MEMORY_SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000;
export const MEMORY_WARM_TOP_K = 8;
export const MEMORY_WARM_TTL_MS = 15 * 60 * 1000;
export const MEMORY_TOPICAL_TOP_K = 5;
export const MEMORY_LEARNED_LIMIT = 8;
export const MEMORY_CONTEXT_LIMIT = 8;
export const MEMORY_MAX_CACHED_USERS = 256;
export const MEMORY_WARM_QUERY =
  "Important durable facts about this person, including identity, relationships, stable preferences and boundaries, ongoing projects and goals, recurring interpersonal context, and significant experiences.";

export interface UserCache {
  baseline: readonly MemoryRecord[];
  baselinePending: boolean;
  baselineLoadedAt: number | undefined;
  topical: readonly MemoryRecord[];
  topicalScheduled: boolean;
  pendingTopicalQuery: string | undefined;
  learned: readonly MemoryRecord[];
  lastActivityAt: number;
}

export interface MemoryJob {
  userId: LongTermMemoryUserId;
  run(): Promise<void>;
}

export type RuntimeLifecycle = "open" | "draining" | "closed";

export interface RuntimeConfig {
  store: LongTermMemoryStore;
  now(): number;
  scheduler: Scheduler;
  warmTopK: number;
  warmTtlMs: number;
  topicalTopK: number;
  learnedLimit: number;
  contextLimit: number;
  maxCachedUsers: number;
  concurrency: number;
  idleDelayMs: number;
  shutdownDrainTimeoutMs: number;
}

export interface RuntimeState {
  cache: Map<string, UserCache>;
  queuedByUser: Map<string, number>;
  queue: MemoryJob[];
  foregroundCount: number;
  running: number;
  lifecycle: RuntimeLifecycle;
  graceElapsed: boolean;
  idleTimer: (() => void) | undefined;
  idleWaiters: (() => void)[];
}
