import type { ReactionContext } from "./reaction-context.js";
import { spawnReactionAttempt, type ReactionThread } from "./reaction-attempt.js";

export type { ReactionContext } from "./reaction-context.js";
export type { CoordinatorLifecycle } from "./reaction-context.js";
export type { ReactionAttempt, ReactionThread } from "./reaction-attempt.js";

/**
 * The properties that this class carries are:
 * - each canonical conversation thread has its own monotonic revision;
 * - every reaction attempt, including superseded ones, stays tracked until its
 *   task physically settles;
 * - a reaction started under an obsolete revision never runs;
 * - a replacement reaction waits for any committed delivery to be reconciled,
 *   and that waiting start is itself tracked;
 * - settle() resolves only when all already-scheduled reaction work, including
 *   pending replacement starts, has reached quiescence;
 * - shutdown aborts everything and does not close until all tasks settle;
 * - errors never produce Telegram dialogue; genuine current-reaction failures
 *   are logged, and expected cancellation and stale failures are low-noise.
 *
 * The proof of those properties is guaranteed by:
 * - `invalidate`: bumps the revision, aborts the current attempt (logging its
 *   captured revision), and stops considering it current while leaving it in
 *   `inFlight`.
 * - `start`: refuses to run when the lifecycle is not open or the revision has
 *   advanced, registers a `pendingStart` while waiting on a committed delivery,
 *   and re-checks revision and lifecycle before spawning.
 * - `spawnReactionAttempt`: keeps the attempt in `inFlight` until its task
 *   settles and applies the silent-on-error failure boundary.
 * - `settle`: repeatedly awaits every in-flight task and every pending start
 *   until no scheduled work remains.
 * - `abortAllAndSettle`: sets the lifecycle to closing, bumps revisions, aborts
 *   every in-flight attempt, and only then clears the threads.
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
      thread = {
        revision: 0, current: undefined, inFlight: new Set(),
        pendingStart: undefined, committedDelivery: undefined,
      };
      this.#threads.set(threadKey, thread);
    }
    return thread;
  }

  /**
   * Marks the thread as superseded: increments its revision and aborts any
   * active reaction, logging the cancelled attempt's own revision. The aborted
   * attempt remains tracked until its task physically settles. Returns the new
   * revision the caller should start under.
   */
  invalidate(threadKey: string): number {
    const thread = this.#threadFor(threadKey);
    const current = thread.current;
    thread.revision += 1;
    if (current !== undefined) {
      current.controller.abort();
      thread.current = undefined;
      console.log(
        `Cancelled reaction thread=${threadKey} revision=${current.revision} reason=newer-message`,
      );
    }
    return thread.revision;
  }

  /**
   * Runs `run` as the reaction for the given thread revision, if that revision
   * is still current. Waits for any committed delivery to be reconciled first;
   * that wait is tracked as a pending start so `settle()` covers it.
   */
  async start(
    threadKey: string,
    revision: number,
    run: (ctx: ReactionContext) => Promise<void>,
  ): Promise<void> {
    const thread = this.#threadFor(threadKey);
    if (this.#lifecycle !== "open" || thread.revision !== revision) return;
    let pending: Promise<void> | undefined;
    try {
      if (thread.committedDelivery !== undefined) {
        // A committed Telegram send is still being reconciled; wait for its
        // outcome (persisted or failed) before acquiring the replacement
        // context. The wait itself is scheduled reaction work.
        pending = new Promise<void>((resolve) => {
          void thread.committedDelivery?.then(() => resolve());
        });
        thread.pendingStart = pending;
        await pending;
        if (this.#threads.get(threadKey)?.revision !== revision) return;
        if (this.#lifecycle !== "open") return;
      }
      spawnReactionAttempt({ threadKey, revision, thread, lifecycle: () => this.#lifecycle, run });
    } finally {
      if (pending !== undefined && thread.pendingStart === pending) {
        thread.pendingStart = undefined;
      }
    }
  }

  /**
   * Waits until every reaction attempt that had been scheduled before this
   * call has physically settled, including replacement starts that were
   * waiting on a committed delivery and any attempts they subsequently spawn.
   */
  async settle(): Promise<void> {
    for (;;) {
      const tasks: Promise<void>[] = [];
      for (const thread of this.#threads.values()) {
        for (const attempt of thread.inFlight) tasks.push(attempt.task);
        if (thread.pendingStart !== undefined) tasks.push(thread.pendingStart);
      }
      if (tasks.length === 0) return;
      await Promise.all(tasks);
    }
  }

  /**
   * Aborts every active reaction and waits for all of them, plus any pending
   * replacement starts, to settle before the lifecycle becomes closed.
   */
  async abortAllAndSettle(): Promise<void> {
    this.#lifecycle = "closing";
    for (const [threadKey, thread] of this.#threads) {
      thread.revision += 1;
      thread.current = undefined;
      for (const attempt of thread.inFlight) {
        attempt.controller.abort();
        console.log(
          `Cancelled reaction thread=${threadKey} revision=${attempt.revision} reason=shutdown`,
        );
      }
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
