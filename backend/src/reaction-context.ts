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
}
