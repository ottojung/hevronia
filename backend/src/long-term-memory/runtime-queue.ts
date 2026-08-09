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
  if (state.closed) return;
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
  const start = (): void => {
    if (state.foregroundCount > 0) return;
    if (state.running >= config.concurrency) return;
    if (state.queue.length === 0) return;
    startNextJob(state, config);
    pump(state, config);
  };
  if (state.closed) {
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
  const key = userKey(job.userId);
  const task = (async () => {
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
  state.inFlight.add(task);
  void task.then(
    () => state.inFlight.delete(task),
    () => state.inFlight.delete(task),
  );
}

export function afterJob(state: RuntimeState, config: RuntimeConfig): void {
  pump(state, config);
  if (state.running === 0 && state.queue.length === 0) {
    const waiters = state.idleWaiters;
    state.idleWaiters = [];
    for (const waiter of waiters) waiter();
  }
}

export function whenIdle(state: RuntimeState): Promise<void> {
  if (state.running === 0 && state.queue.length === 0) return Promise.resolve();
  return new Promise((resolve) => { state.idleWaiters.push(resolve); });
}

export async function drain(state: RuntimeState, config: RuntimeConfig): Promise<void> {
  if (state.running === 0 && state.queue.length === 0) return;
  let cancel: (() => void) | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    cancel = config.scheduler.schedule(() => resolve("timeout"), config.shutdownDrainTimeoutMs);
  });
  const outcome = await Promise.race([whenIdle(state).then(() => "drained"), deadline]);
  cancel?.();
  if (outcome === "timeout") {
    console.warn(
      `Timed out draining ${state.running} running and ${state.queue.length} queued long-term-memory jobs`,
    );
  }
}
