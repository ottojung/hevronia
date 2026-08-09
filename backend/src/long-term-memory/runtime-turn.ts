import type { LongTermMemoryUserId } from "../identifiers.js";
import { project, userKey } from "./runtime-cache.js";
import { drainUntilIdle, pump } from "./runtime-queue.js";
import type { LongTermMemoryTurn, RuntimeConfig, RuntimeState } from "./runtime-types.js";

export function beginTurn(state: RuntimeState, config: RuntimeConfig): LongTermMemoryTurn {
  if (state.idleTimer !== undefined) {
    state.idleTimer();
    state.idleTimer = undefined;
  }
  state.graceElapsed = false;
  state.foregroundCount += 1;
  const snapshotCache = new Map(state.cache);
  let released = false;
  return {
    snapshot: {
      memoriesFor(userId: LongTermMemoryUserId) {
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
}

export function discardQueued(state: RuntimeState): number {
  const discarded = state.queue.length;
  for (const job of state.queue) {
    const key = userKey(job.userId);
    const count = state.queuedByUser.get(key);
    if (count !== undefined) {
      if (count <= 1) state.queuedByUser.delete(key);
      else state.queuedByUser.set(key, count - 1);
    }
  }
  state.queue.length = 0;
  return discarded;
}

export async function closeRuntime(state: RuntimeState, config: RuntimeConfig): Promise<void> {
  if (state.lifecycle !== "open") return;
  state.lifecycle = "draining";
  if (state.idleTimer !== undefined) {
    state.idleTimer();
    state.idleTimer = undefined;
  }
  pump(state, config);
  const outcome = await drainUntilIdle(state, config);
  if (outcome === "timeout") {
    const discarded = discardQueued(state);
    console.warn(
      `Timed out draining ${state.running} running long-term-memory jobs; discarded ${discarded} queued`,
    );
  }
  state.lifecycle = "closed";
}
