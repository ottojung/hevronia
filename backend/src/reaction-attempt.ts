import { errorDetail } from "./error-detail.js";
import { isReactionCancelledError, ReactionCancelledError } from "./reaction-cancelled.js";
import type { ReactionContext } from "./reaction-context.js";

export type { CoordinatorLifecycle } from "./reaction-context.js";

export interface ReactionAttempt {
  controller: AbortController;
  task: Promise<void>;
  /** The thread revision this attempt captured (used for diagnostics). */
  revision: number;
  /** True once this attempt committed a Telegram delivery send. */
  committed: boolean;
}

export interface ReactionThread {
  revision: number;
  current: ReactionAttempt | undefined;
  /** Every attempt that has not physically settled, including obsolete ones. */
  inFlight: Set<ReactionAttempt>;
  /** A replacement start currently waiting on a committed delivery. */
  pendingStart: Promise<void> | undefined;
  /** Resolves when a committed delivery's outcome is reconciled. */
  committedDelivery: Promise<void> | undefined;
}

export interface SpawnReactionParams {
  threadKey: string;
  revision: number;
  thread: ReactionThread;
  lifecycle: () => import("./reaction-context.js").CoordinatorLifecycle;
  run: (ctx: ReactionContext) => Promise<void>;
}

/**
 * Creates and starts one reaction attempt: registers it as the thread's
 * current attempt and in the in-flight set, builds the reaction context with
 * staleness and commit-boundary support, and runs the reaction task. Errors
 * never produce Telegram dialogue: a genuine current-reaction failure is logged
 * internally and terminates the reaction; expected cancellation, stale
 * failures, and shutdown failures stay low-noise. The attempt stays in the
 * in-flight set until its task physically settles, so shutdown never closes
 * resources while an obsolete operation is still unwinding.
 */
export function spawnReactionAttempt(params: SpawnReactionParams): ReactionAttempt {
  const { threadKey, revision, thread, lifecycle, run } = params;
  const controller = new AbortController();
  const attempt: ReactionAttempt = { controller, task: Promise.resolve(), revision, committed: false };
  thread.current = attempt;
  thread.inFlight.add(attempt);
  const isCurrent = (): boolean =>
    thread.revision === revision && thread.current === attempt;
  const ctx: ReactionContext = {
    threadKey,
    revision,
    signal: controller.signal,
    isCurrent,
    throwIfStale: () => {
      if (controller.signal.aborted || !isCurrent()) throw new ReactionCancelledError();
    },
    beginCommittedDelivery: () => {
      attempt.committed = true;
      let complete: () => void = () => undefined;
      thread.committedDelivery = new Promise<void>((resolve) => { complete = resolve; });
      return { complete };
    },
  };
  const task = (async () => {
    console.log(`Started reaction thread=${threadKey} revision=${revision}`);
    try {
      await run(ctx);
    } catch (error) {
      if (isReactionCancelledError(error)) return;
      if (lifecycle() !== "open") return;
      if (!isCurrent() && !attempt.committed) return;
      console.error(`Reaction failed thread=${threadKey} revision=${revision}: ${errorDetail(error)}`);
    } finally {
      thread.inFlight.delete(attempt);
      if (thread.current === attempt) thread.current = undefined;
    }
  })();
  attempt.task = task;
  void task;
  return attempt;
}
