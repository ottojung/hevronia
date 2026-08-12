import { errorDetail } from "./error-detail.js";
import { isReactionCancelledError, ReactionCancelledError } from "./reaction-cancelled.js";
import type { ReactionContext } from "./reaction-context.js";

export type { ReactionContext } from "./reaction-context.js";

interface ReactionAttempt {
  controller: AbortController;
  task: Promise<void>;
}

interface ReactionThread {
  revision: number;
  active: ReactionAttempt | undefined;
}

/**
 * The properties that this class carries are:
 * - each canonical conversation thread has its own monotonic revision and at
 *   most one active reaction;
 * - `invalidate` bumps the revision and aborts the active reaction immediately;
 * - a reaction started under an older revision never runs;
 * - a reaction whose revision has advanced never delivers;
 * - `abortAllAndSettle` aborts every active reaction and waits for it to end.
 *
 * The proof of those properties is guaranteed by:
 * - `invalidate`: increments `thread.revision` and aborts the controller of
 *   the currently active attempt before it can deliver.
 * - `start`: captures the revision returned by `invalidate` and refuses to run
 *   when the thread's revision has already advanced.
 * - `isCurrent`: compares the thread revision to the captured revision and
 *   requires the stored active attempt to still be this one, so a reaction
 *   that resolves after cancellation is still discarded.
 * - `abortAllAndSettle`: bumps every thread's revision, aborts all active
 *   controllers, and awaits all active tasks before the layer closes.
 */
export class ReactionCoordinator {
  readonly #threads = new Map<string, ReactionThread>();

  /**
   * Marks the thread as superseded: increments its revision and aborts any
   * active reaction. Returns the new revision the caller should start under.
   */
  invalidate(threadKey: string): number {
    const thread = this.#threads.get(threadKey) ?? { revision: 0, active: undefined };
    thread.revision += 1;
    if (thread.active !== undefined) {
      thread.active.controller.abort();
      thread.active = undefined;
      console.log(
        `Cancelled reaction thread=${threadKey} revision=${thread.revision} reason=newer-message`,
      );
    }
    this.#threads.set(threadKey, thread);
    return thread.revision;
  }

  /**
   * Runs `run` as the reaction for the given thread revision, if that revision
   * is still current. The returned promise settles when the reaction does.
   */
  async start(
    threadKey: string,
    revision: number,
    run: (ctx: ReactionContext) => Promise<void>,
  ): Promise<void> {
    const thread = this.#threads.get(threadKey);
    if (thread === undefined || thread.revision !== revision) {
      return;
    }
    const controller = new AbortController();
    const attempt: ReactionAttempt = { controller, task: Promise.resolve() };
    thread.active = attempt;
    const ctx: ReactionContext = {
      threadKey,
      revision,
      signal: controller.signal,
      isCurrent: () => this.#threads.get(threadKey)?.revision === revision
        && thread.active === attempt,
      throwIfStale: () => {
        if (controller.signal.aborted || !(this.#threads.get(threadKey)?.revision === revision
          && thread.active === attempt)) {
          throw new ReactionCancelledError();
        }
      },
    };
    const task = (async () => {
      console.log(`Started reaction thread=${threadKey} revision=${revision}`);
      try {
        await run(ctx);
      } catch (error) {
        if (!isReactionCancelledError(error)) {
          console.error(
            `Reaction failed thread=${threadKey} revision=${revision}: ${errorDetail(error)}`,
          );
        }
      } finally {
        if (thread.active === attempt) thread.active = undefined;
      }
    })();
    attempt.task = task;
    void task;
    await task;
  }

  /** Waits for all currently active reactions to settle. */
  async settle(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const thread of this.#threads.values()) {
      if (thread.active !== undefined) tasks.push(thread.active.task);
    }
    await Promise.all(tasks);
  }

  /** Aborts every active reaction and waits for them all to settle. */
  async abortAllAndSettle(): Promise<void> {
    for (const [threadKey, thread] of this.#threads) {
      if (thread.active !== undefined) {
        thread.revision += 1;
        thread.active.controller.abort();
        console.log(
          `Cancelled reaction thread=${threadKey} revision=${thread.revision} reason=shutdown`,
        );
      }
    }
    await this.settle();
    this.#threads.clear();
  }

  activeCount(): number {
    let count = 0;
    for (const thread of this.#threads.values()) {
      if (thread.active !== undefined) count += 1;
    }
    return count;
  }
}
