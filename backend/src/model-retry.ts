import { isTransientError, sleep } from "./retry.js";
import {
  isRateLimitError,
  rateLimitRetryDelayMs,
} from "./model-rate-limit.js";

export { isRateLimitError, rateLimitRetryDelayMs } from "./model-rate-limit.js";

export const MODEL_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const MODEL_RATE_LIMIT_BASE_DELAY_MS = 2_000;

export interface ModelRateLimitRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

/**
 * Runs a model operation, retrying it with a bounded fixed delay whenever the
 * provider rate-limits us or a transient transport failure occurs. Other
 * failures are never retried, and the wait is the provider's suggested delay
 * or a fixed base, never exponential.
 */
export async function invokeWithRateLimitRetry<T>(
  operation: () => Promise<T>,
  options: ModelRateLimitRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? MODEL_RATE_LIMIT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? MODEL_RATE_LIMIT_BASE_DELAY_MS;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableModelError(error)) throw error;
      const delayMs = rateLimitRetryDelayMs(error, baseDelayMs);
      console.warn(
        `Model provider request failed transiently; retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`,
      );
      await sleep(delayMs);
    }
  }
}

function isRetryableModelError(error: unknown): boolean {
  return isRateLimitError(error) || isTransientError(error);
}
