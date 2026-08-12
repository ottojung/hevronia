import { isTransientError, sleep } from "./retry.js";
import { isReactionCancelledError, sleepAbortable, throwIfAborted } from "./reaction-cancelled.js";
import {
  isRateLimitError,
  rateLimitRetryDelayMs,
} from "./model-rate-limit.js";

export { isRateLimitError, rateLimitRetryDelayMs } from "./model-rate-limit.js";

export const MODEL_RATE_LIMIT_BASE_DELAY_MS = 2_000;

export interface ModelRateLimitRetryOptions {
  baseDelayMs?: number;
  signal?: AbortSignal;
}

/**
 * Runs a model operation, retrying it with a fixed delay whenever the
 * provider rate-limits us or a transient transport failure occurs. Other
 * failures are never retried, and the wait is the provider's suggested delay
 * (capped at 24 hours) or a fixed base, never exponential and with no attempt
 * limit. An aborted signal cancels the operation immediately: before the call,
 * during it, or while waiting for a retry — a cancelled request is never
 * retried.
 */
export async function invokeWithRateLimitRetry<T>(
  operation: () => Promise<T>,
  options: ModelRateLimitRetryOptions = {},
): Promise<T> {
  const { signal } = options;
  const baseDelayMs = options.baseDelayMs ?? MODEL_RATE_LIMIT_BASE_DELAY_MS;
  throwIfAborted(signal);
  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await operation();
      throwIfAborted(signal);
      return result;
    } catch (error) {
      if (signal !== undefined && (signal.aborted || isReactionCancelledError(error))) {
        throw error;
      }
      if (!isRetryableModelError(error)) throw error;
      const delayMs = rateLimitRetryDelayMs(error, baseDelayMs);
      console.warn(
        `Model provider request failed transiently; retrying in ${delayMs}ms (attempt ${attempt})`,
      );
      if (signal === undefined) {
        await sleep(delayMs);
      } else {
        await sleepAbortable(delayMs, signal);
      }
      throwIfAborted(signal);
    }
  }
}

function isRetryableModelError(error: unknown): boolean {
  return isRateLimitError(error) || isTransientError(error);
}
