import type { RuntimeConfig, RuntimeState } from "./runtime-types.js";

export function evictIfNeeded(state: RuntimeState, config: RuntimeConfig): void {
  if (state.cache.size <= config.maxCachedUsers) return;
  const candidates = [...state.cache.keys()]
    .filter((key) => (state.queuedByUser.get(key) ?? 0) === 0)
    .sort((a, b) => {
      const aEntry = state.cache.get(a);
      const bEntry = state.cache.get(b);
      return (aEntry?.lastActivityAt ?? 0) - (bEntry?.lastActivityAt ?? 0);
    });
  for (const key of candidates) {
    if (state.cache.size <= config.maxCachedUsers) break;
    state.cache.delete(key);
  }
}
