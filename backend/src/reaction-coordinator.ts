import { errorDetail } from "./error-detail.js";
import { isReactionCancelledError, ReactionCancelledError } from "./reaction-cancelled.js";
import type { ReactionContext } from "./reaction-context.js";

export type { ReactionContext } from "./reaction-context.js";

export type CoordinatorLifecycle = "open" | "closing" | "closed";

/** Invoked for genuine current-reaction failures that may produce fallback. */
export interface ReactionFailureHandler {
  (error: unknown, ctx: ReactionContext): void | Promise<void>;
}

export interface StartReactionOptions {
  onCurrentReactionFailure?: ReactionFailureHandler;
}

interface ReactionAttempt {
  controller: AbortController;
  task: Promise<void>;
  /** True once this attempt committed a Telegram delivery send. */
  committed: boolean;
}

interface ReactionThread {
  revision: number;
  current: ReactionAttempt | undefined;
  /** Every attempt that has not physically settled, including obsolete ones. */
  inFlight: Set<ReactionAttempt>;
  /** Resolves when a committed delivery's outcome is reconciled; the next reaction waits for it. */
  committedDelivery: Promise<void> | undefined;
}

/**
 * The properties that this class carries are:
 * - each canonical conversation thread has its own monotonic revision;
 * - every reaction attempt, including superseded ones, stays tracked until its
 *   task physically settles;
 * - a reaction started under an obsolete revision never runs;
 * - a replacement reaction waits for any committed delivery to be reconciled;
 * - a committed Telegram send's confirmed result is always persisted;
 * - shutdown aborts everything and does not close until all tasks settle;
 * - genuine current-reaction failures are handed to an explicit handler;
 *   expected cancellation and stale failures are never treated as errors.
 *
 * The proof of those properties is guaranteed by:
 * - `invalidate`: bumps the revision, aborts the current attempt, and stops
 *   considering it current while leaving it in `inFlight`.
 * - `start`: refuses to run when the lifecycle is not open or the revision has
 *   advanced, and re-checks after waiting for a committed delivery.
 * - `beginCommittedDelivery`: marks the attempt committed and installs a
 *   per-thread promise that the reaction resolves after persistence, so the
 *   send's confirmed result is never discarded.
 * - `settle`: awaits every physically in-flight task.
 * - `abortAllAndSettle`: sets the lifecycle to closing, bumps revisions, aborts
 *   every attempt, awaits all of them, and only then clears the threads.
 */
export class ReactionCoordinator {
  readonly #threads = new Map<string, ReactionThread>();
  #lifecycle: CoordinatorLifecycle = "open";

  get lifecycle(): CoordinatorLifecycle {
    return this.#lifecycle;
  }

  #threadFor(threadKey: string): ReactionThread {
    let thread = this.#threads.get(threadKey);
    if (thread === undefined) {
      thread = { revision: 0, current: undefined, inFlight: new Set(), committedDelivery: undefined };
      this.#threads.set(threadKey, thread);
    }
    return thread;
  }

  /**
   * Marks the thread as superseded: increments its revision and aborts any
   * active reaction. The aborted attempt remains tracked until its task
   * physically settles. Returns the new revision the caller should start under.
   */
  invalidate(threadKey: string): number {
    const thread = this.#threadFor(threadKey);
    thread.revision += 1;
    if (thread.current !== undefined) {
      thread.current.controller.abort();
      thread.current = undefined;
      console.log(
        `Cancelled reaction thread=${threadKey} revision=${thread.revision} reason=newer-message`,
      );
    }
    return thread.revision;
  }

  /**
   * Runs `run` as the reaction for the given thread revision, if that revision
   * is still current. Waits for any committed delivery to be reconciled first.
   * The returned promise settles when the reaction does.
   */
  async start(
    threadKey: string,
    revision: number,
    run: (ctx: ReactionContext) => Promise<void>,
    options: StartReactionOptions = {},
  ): Promise<void> {
    const thread = this.#threadFor(threadKey);
    if (this.#lifecycle !== "open" || thread.revision !== revision) return;
    if (thread.committedDelivery !== undefined) {
      // A committed Telegram send is still being reconciled; wait for its
      // outcome (persisted or failed) before acquiring the replacement context.
      await thread.committedDelivery;
      if (this.#threads.get(threadKey)?.revision !== revision) return;
    }
    if (this.#lifecycle !== "open") return;

    const controller = new AbortController();
    const attempt: ReactionAttempt = { controller, task: Promise.resolve(), committed: false };
    thread.current = attempt;
    thread.inFlight.add(attempt);

    const ctx: ReactionContext = {
      threadKey,
      revision,
      signal: controller.signal,
      isCurrent: () => this.#threads.get(threadKey)?.revision === revision
        && thread.current === attempt,
      throwIfStale: () => {
        if (controller.signal.aborted || !(this.#threads.get(threadKey)?.revision === revision
          && thread.current === attempt)) {
          throw new ReactionCancelledError();
        }
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
        if (this.#lifecycle !== "open") {
          console.log(`Reaction failed thread=${threadKey} revision=${revision} during shutdown`);
          return;
        }
        if (!ctx.isCurrent() && !attempt.committed) return;
        try {
          await options.onCurrentReactionFailure?.(error, ctx);
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
    await task;
  }

  /** Waits for every physically in-flight reaction, including obsolete ones. */
  async settle(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const thread of this.#threads.values()) {
      for (const attempt of thread.inFlight) tasks.push(attempt.task);
    }
    await Promise.all(tasks);
  }

  /**
   * Aborts every active reaction and waits for all of them to settle before
   * the lifecycle becomes closed.
   */
  async abortAllAndSettle(): Promise<void> {
    this.#lifecycle = "closing";
    for (const [threadKey, thread] of this.#threads) {
      thread.revision += 1;
      if (thread.current !== undefined) {
        thread.current.controller.abort();
        console.log(
          `Cancelled reaction thread=${threadKey} revision=${thread.revision} reason=shutdown`,
        );
      }
      for (const attempt of thread.inFlight) attempt.controller.abort();
    }
    await this.settle();
    this.#threads.clear();
    this.#lifecycle = "closed";
  }

  activeCount(): number {
    let count = 0;
    for (const thread of this.#threads.values()) {
      count += thread.inFlight.size;
    }
    return count;
  }
}
