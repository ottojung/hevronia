/**
 * The per-attempt reaction context handed to a reaction task by the
 * coordinator: the thread key, the captured revision, the abort signal, and a
 * staleness check that throws `ReactionCancelledError` when a newer event (or
 * shutdown) superseded the attempt.
 */
export interface ReactionContext {
  readonly threadKey: string;
  readonly revision: number;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  throwIfStale(): void;
  /**
   * Enters the delivery commit phase for the thread: from this point a
   * Telegram send is committed and its confirmed result must be reconciled
   * with canonical history regardless of later revisions. Marks this attempt
   * as committed and returns a `complete()` callback the caller invokes once
   * the send outcome is persisted (or has failed), so a waiting replacement
   * reaction can proceed.
   */
  beginCommittedDelivery(): { complete(): void };
}

export type CoordinatorLifecycle = "open" | "closing" | "closed";
