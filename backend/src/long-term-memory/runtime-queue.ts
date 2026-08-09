import type { LongTermMemoryUserId } from "../identifiers.js";
import { operationalErrorDetail } from "./operations.js";
import { userKey } from "./runtime-cache.js";
import { evictIfNeeded } from "./runtime-eviction.js";
import type { MemoryJob, RuntimeConfig, RuntimeState } from "./runtime-types.js";

export function enqueue(
  state: RuntimeState,
  config: RuntimeConfig,
  userId: LongTermMemoryUserId,
  job: MemoryJob,
): void {
  if (state.lifecycle !== "open") return;
  state.queue.push(job);
  const key = userKey(userId);
  state.queuedByUser.set(key, (state.queuedByUser.get(key) ?? 0) + 1);
  pump(state, config);
}

export function pump(state: RuntimeState, config: RuntimeConfig): void {
  if (state.idleTimer !== undefined) return;
  if (state.foregroundCount > 0) return;
  if (state.running >= config.concurrency) return;
  if (state.queue.length === 0) return;
  if (state.lifecycle === "closed") return;
  const start = (): void => {
    if (state.foregroundCount > 0) return;
    if (state.running >= config.concurrency) return;
    if (state.queue.length === 0) return;
    if (state.lifecycle === "closed") return;
    startNextJob(state, config);
    pump(state, config);
  };
  if (state.lifecycle === "draining" || state.graceElapsed) {
    start();
    return;
  }
  state.idleTimer = config.scheduler.schedule(() => {
    state.idleTimer = undefined;
    start();
  }, config.idleDelayMs);
}

export function startNextJob(state: RuntimeState, config: RuntimeConfig): void {
  const job = state.queue.shift();
  if (job === undefined) return;
  state.running += 1;
  state.graceElapsed = true;
  const key = userKey(job.userId);
  void (async () => {
    try {
      await job.run();
    } catch (error) {
      console.warn(`Long-term-memory background job failed: ${operationalErrorDetail(error)}`);
    } finally {
      state.running -= 1;
      const count = state.queuedByUser.get(key);
      if (count !== undefined) {
        if (count <= 1) state.queuedByUser.delete(key);
        else state.queuedByUser.set(key, count - 1);
      }
      evictIfNeeded(state, config);
      afterJob(state, config);
    }
  })();
}

export function afterJob(state: RuntimeState, config: RuntimeConfig): void {
  if (state.running === 0 && state.queue.length === 0) {
    state.graceElapsed = false;
    const waiters = state.idleWaiters;
    state.idleWaiters = [];
    for (const waiter of waiters) waiter();
  }
  pump(state, config);
}

export function whenIdle(state: RuntimeState): Promise<void> {
  if (state.running === 0 && state.queue.length === 0) return Promise.resolve();
  return new Promise((resolve) => { state.idleWaiters.push(resolve); });
}

export async function drainUntilIdle(
  state: RuntimeState,
  config: RuntimeConfig,
): Promise<"drained" | "timeout"> {
  if (state.running === 0 && state.queue.length === 0) return "drained";
  let cancel: (() => void) | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    cancel = config.scheduler.schedule(() => resolve("timeout"), config.shutdownDrainTimeoutMs);
  });
  const outcome = await Promise.race([
    whenIdle(state).then((): "drained" => "drained"),
    deadline,
  ]);
  cancel?.();
  return outcome;
}
