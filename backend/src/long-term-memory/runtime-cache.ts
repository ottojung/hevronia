import type { LongTermMemoryUserId } from "../identifiers.js";
import type { MemoryRecord } from "./index.js";
import type { RecalledMemory, RuntimeConfig, RuntimeState, UserCache } from "./runtime-types.js";

export function userKey(userId: LongTermMemoryUserId): string {
  return userId.toPersistenceKey();
}

export function emptyUserCache(now: number): UserCache {
  return {
    baseline: [],
    baselinePending: false,
    baselineLoadedAt: 0,
    topical: [],
    topicalScheduled: false,
    pendingTopicalQuery: undefined,
    learned: [],
    lastActivityAt: now,
  };
}

export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replaceAll(/\s+/gu, " ");
}

export function ensureEntry(
  state: RuntimeState,
  config: RuntimeConfig,
  userId: LongTermMemoryUserId,
): UserCache {
  const key = userKey(userId);
  const existing = state.cache.get(key);
  if (existing !== undefined) return existing;
  const entry = emptyUserCache(config.now());
  state.cache.set(key, entry);
  return entry;
}

export function replaceEntry(
  state: RuntimeState,
  userId: LongTermMemoryUserId,
  mutate: (entry: UserCache) => UserCache,
): void {
  const key = userKey(userId);
  const current = state.cache.get(key);
  if (current === undefined) return;
  state.cache.set(key, mutate(current));
}

export function touch(config: RuntimeConfig, entry: UserCache): UserCache {
  return { ...entry, lastActivityAt: config.now() };
}

export function mergeLearned(
  state: RuntimeState,
  config: RuntimeConfig,
  userId: LongTermMemoryUserId,
  records: readonly MemoryRecord[],
): void {
  replaceEntry(state, userId, (entry) => {
    const merged: MemoryRecord[] = [];
    for (const record of [...records, ...entry.learned]) {
      if (merged.some((existing) => existing.id === record.id)) continue;
      const normalized = normalizeText(record.text);
      if (merged.some((existing) => normalizeText(existing.text) === normalized)) continue;
      merged.push(record);
      if (merged.length >= config.learnedLimit) break;
    }
    return touch(config, { ...entry, learned: merged });
  });
}

export function mergeTopical(
  state: RuntimeState,
  config: RuntimeConfig,
  userId: LongTermMemoryUserId,
  records: readonly MemoryRecord[],
): void {
  replaceEntry(state, userId, (entry) => touch(config, { ...entry, topical: records }));
}

export function mergeBaseline(
  state: RuntimeState,
  config: RuntimeConfig,
  userId: LongTermMemoryUserId,
  records: readonly MemoryRecord[],
): void {
  replaceEntry(state, userId, (entry) => touch(config, {
    ...entry, baseline: records, baselinePending: false, baselineLoadedAt: config.now(),
  }));
}

export function clearBaselinePending(state: RuntimeState, userId: LongTermMemoryUserId): void {
  replaceEntry(state, userId, (entry) =>
    entry.baselinePending ? { ...entry, baselinePending: false } : entry);
}

export function project(config: RuntimeConfig, entry: UserCache | undefined): RecalledMemory[] {
  if (entry === undefined) return [];
  const combined: MemoryRecord[] = [];
  for (const record of [...entry.topical, ...entry.learned, ...entry.baseline]) {
    if (record.id !== undefined && combined.some((existing) => existing.id === record.id)) continue;
    const normalized = normalizeText(record.text);
    if (combined.some((existing) => normalizeText(existing.text) === normalized)) continue;
    combined.push(record);
    if (combined.length >= config.contextLimit) break;
  }
  return combined.map(({ text }) => ({ text }));
}
