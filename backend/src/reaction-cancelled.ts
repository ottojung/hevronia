/**
 * Expected control-flow outcome when a newer Telegram event (or shutdown)
 * invalidates an in-flight reaction. Distinct from genuine planner/realizer
 * failures so an abort never fails open into the smart realizer, never
 * triggers fallback text, and is never reported as a completed decision.
 */
export class ReactionCancelledError extends Error {
  constructor() {
    super("Reaction cancelled");
    this.name = "ReactionCancelledError";
  }
}

export function isReactionCancelledError(error: unknown): boolean {
  if (error instanceof ReactionCancelledError) return true;
  // LangChain providers throw DOMException/Error named "AbortError" when a
  // passed AbortSignal aborts a model invocation.
  return error instanceof Error && error.name === "AbortError";
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal !== undefined && signal.aborted) throw new ReactionCancelledError();
}

/** A cancellable sleep so an aborted retry wait stops immediately. */
export function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ReactionCancelledError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new ReactionCancelledError());
    }, { once: true });
  });
}
