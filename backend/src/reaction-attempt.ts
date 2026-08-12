import { errorDetail } from "./error-detail.js";
import { isReactionCancelledError, ReactionCancelledError } from "./reaction-cancelled.js";
import type { ReactionContext, ReactionFailureHandler } from "./reaction-context.js";

export type { CoordinatorLifecycle } from "./reaction-context.js";
export type { ReactionFailureHandler } from "./reaction-context.js";

export interface ReactionAttempt {
  controller: AbortController;
  task: Promise<void>;
  /** True once this attempt committed a Telegram delivery send. */
  committed: boolean;
}

export interface ReactionThread {
  revision: number;
  current: ReactionAttempt | undefined;
  /** Every attempt that has not physically settled, including obsolete ones. */
  inFlight: Set<ReactionAttempt>;
  /** Resolves when a committed delivery's outcome is reconciled. */
  committedDelivery: Promise<void> | undefined;
}

export interface SpawnReactionParams {
  threadKey: string;
  revision: number;
  thread: ReactionThread;
  lifecycle: () => import("./reaction-context.js").CoordinatorLifecycle;
  run: (ctx: ReactionContext) => Promise<void>;
  onCurrentReactionFailure?: ReactionFailureHandler;
}

/**
 * Creates and starts one reaction attempt: registers it as the thread's
 * current attempt and in the in-flight set, builds the reaction context with
 * staleness and commit-boundary support, and runs the reaction task with an
 * explicit failure boundary. Genuine current-reaction failures are handed to
 * `onCurrentReactionFailure`; expected cancellation, stale failures, and
 * shutdown failures are silent. The attempt stays in the in-flight set until
 * its task physically settles, so shutdown never closes resources while an
 * obsolete operation is still unwinding.
 */
export function spawnReactionAttempt(params: SpawnReactionParams): ReactionAttempt {
  const { threadKey, revision, thread, lifecycle, run, onCurrentReactionFailure } = params;
  const controller = new AbortController();
  const attempt: ReactionAttempt = { controller, task: Promise.resolve(), committed: false };
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
      if (lifecycle() !== "open") {
        console.log(`Reaction failed thread=${threadKey} revision=${revision} during shutdown`);
        return;
      }
      if (!isCurrent() && !attempt.committed) return;
      try {
        await onCurrentReactionFailure?.(error, ctx);
      } catch (failureError) {
        console.error(
          `Reaction failure handling failed thread=${threadKey} revision=${revision}: ${errorDetail(failureError)}`,
        );
      }
    } finally {
      thread.inFlight.delete(attempt);
      if (thread.current === attempt) thread.current = undefined;
    }
  })();
  attempt.task = task;
  void task;
  return attempt;
}
