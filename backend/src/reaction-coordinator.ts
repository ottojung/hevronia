import type { ReactionContext } from "./reaction-context.js";
import { spawnReactionAttempt, type ReactionThread } from "./reaction-attempt.js";

export type { ReactionContext } from "./reaction-context.js";
export type { CoordinatorLifecycle, ReactionFailureHandler } from "./reaction-context.js";
export type { ReactionAttempt, ReactionThread } from "./reaction-attempt.js";

export interface StartReactionOptions {
  onCurrentReactionFailure?: import("./reaction-context.js").ReactionFailureHandler;
}

/**
 * The properties that this class carries are:
 * - each canonical conversation thread has its own monotonic revision;
 * - every reaction attempt, including superseded ones, stays tracked until its
 *   task physically settles;
 * - a reaction started under an obsolete revision never runs;
 * - a replacement reaction waits for any committed delivery to be reconciled;
 * - shutdown aborts everything and does not close until all tasks settle;
 * - genuine current-reaction failures are handed to an explicit handler;
 *   expected cancellation and stale failures are never treated as errors.
 *
 * The proof of those properties is guaranteed by:
 * - `invalidate`: bumps the revision, aborts the current attempt, and stops
 *   considering it current while leaving it in `inFlight`.
 * - `start`: refuses to run when the lifecycle is not open or the revision has
 *   advanced, and re-checks after waiting for a committed delivery.
 * - `spawnReactionAttempt`: keeps the attempt in `inFlight` until its task
 *   settles and applies the failure boundary.
 * - `settle`: awaits every physically in-flight task.
 * - `abortAllAndSettle`: sets the lifecycle to closing, bumps revisions, aborts
 *   every attempt, awaits all of them, and only then clears the threads.
 */
export class ReactionCoordinator {
  readonly #threads = new Map<string, ReactionThread>();
  #lifecycle: import("./reaction-context.js").CoordinatorLifecycle = "open";

  get lifecycle(): import("./reaction-context.js").CoordinatorLifecycle {
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
    spawnReactionAttempt({
      threadKey,
      revision,
      thread,
      lifecycle: () => this.#lifecycle,
      run,
      onCurrentReactionFailure: options.onCurrentReactionFailure,
    });
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
