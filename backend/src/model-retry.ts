import { isTransientError, sleep } from "./retry.js";
import {
  isRateLimitError,
  rateLimitRetryDelayMs,
} from "./model-rate-limit.js";

export { isRateLimitError, rateLimitRetryDelayMs } from "./model-rate-limit.js";

export const MODEL_RATE_LIMIT_BASE_DELAY_MS = 2_000;

export interface ModelRateLimitRetryOptions {
  baseDelayMs?: number;
}

/**
 * Runs a model operation, retrying it with a fixed delay whenever the
 * provider rate-limits us or a transient transport failure occurs. Other
 * failures are never retried, and the wait is the provider's suggested delay
 * (capped at 24 hours) or a fixed base, never exponential and with no attempt
 * limit.
 */
export async function invokeWithRateLimitRetry<T>(
  operation: () => Promise<T>,
  options: ModelRateLimitRetryOptions = {},
): Promise<T> {
  const baseDelayMs = options.baseDelayMs ?? MODEL_RATE_LIMIT_BASE_DELAY_MS;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableModelError(error)) throw error;
      const delayMs = rateLimitRetryDelayMs(error, baseDelayMs);
      console.warn(
        `Model provider request failed transiently; retrying in ${delayMs}ms (attempt ${attempt})`,
      );
      await sleep(delayMs);
    }
  }
}

function isRetryableModelError(error: unknown): boolean {
  return isRateLimitError(error) || isTransientError(error);
}
