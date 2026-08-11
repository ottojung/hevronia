import { GoogleGenerativeAIFetchError } from "@google/generative-ai";
import { RateLimitError } from "openai";

export const MODEL_RATE_LIMIT_MAX_DELAY_MS = 30_000;

const RATE_LIMIT_MESSAGE =
  /\b429\b|rate.?limit|insufficient.?quota|too many requests|resource.exhausted/i;

/**
 * Recognizes provider rate limiting. The OpenAI SDK throws `RateLimitError`
 * for 429 responses, Google throws `GoogleGenerativeAIFetchError` with a 429
 * status, and either may be wrapped by a transport layer; the walk recurses
 * through error `cause` chains and finally falls back to the message text.
 */
export function isRateLimitError(error: unknown): boolean {
  const evidence: string[] = [];
  collectRateLimitEvidence(error, evidence);
  return evidence.some((text) => RATE_LIMIT_MESSAGE.test(text));
}

/**
 * The wait before a retry: the provider's own suggested delay when it
 * supplies one (OpenAI `Retry-After` header, Google `retryDelay` detail),
 * capped, otherwise the caller's fixed base delay. No exponential backoff.
 */
export function rateLimitRetryDelayMs(error: unknown, baseDelayMs: number): number {
  const providedSeconds = retryAfterSeconds(error);
  if (providedSeconds === undefined) return baseDelayMs;
  return Math.min(providedSeconds * 1_000, MODEL_RATE_LIMIT_MAX_DELAY_MS);
}

function collectRateLimitEvidence(error: unknown, evidence: string[]): void {
  if (!(error instanceof Error)) return;
  evidence.push(error.message);
  if (error instanceof RateLimitError) {
    evidence.push(String(error.status));
    if (error.code !== null && error.code !== undefined) evidence.push(error.code);
    if (error.type !== undefined) evidence.push(error.type);
    if (typeof error.error === "object" && error.error !== null) {
      if ("code" in error.error && typeof error.error.code === "string") {
        evidence.push(error.error.code);
      }
    }
    const retryAfter = retryAfterSecondsFromHeaders(error.headers);
    if (retryAfter !== undefined) evidence.push(String(retryAfter));
  }
  if (error instanceof GoogleGenerativeAIFetchError) {
    if (error.status !== undefined) evidence.push(String(error.status));
    for (const detail of error.errorDetails ?? []) {
      if (typeof detail === "object" && detail !== null &&
        "retryDelay" in detail && typeof detail["retryDelay"] === "string") {
        evidence.push(detail["retryDelay"]);
      }
    }
  }
  if (error.cause instanceof Error) collectRateLimitEvidence(error.cause, evidence);
}

function retryAfterSeconds(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error instanceof RateLimitError) {
    const fromHeaders = retryAfterSecondsFromHeaders(error.headers);
    if (fromHeaders !== undefined) return fromHeaders;
  }
  if (error instanceof GoogleGenerativeAIFetchError) {
    for (const detail of error.errorDetails ?? []) {
      if (typeof detail === "object" && detail !== null &&
        "retryDelay" in detail && typeof detail["retryDelay"] === "string") {
        const seconds = parseDurationSeconds(detail["retryDelay"]);
        if (seconds !== undefined) return seconds;
      }
    }
  }
  if (error.cause instanceof Error) return retryAfterSeconds(error.cause);
  return undefined;
}

function retryAfterSecondsFromHeaders(headers: Headers | undefined): number | undefined {
  if (headers === undefined || typeof headers.get !== "function") return undefined;
  const value = headers.get("retry-after");
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function parseDurationSeconds(value: string): number | undefined {
  const match = /^([0-9]+(?:\.[0-9]+)?)(ms|s)?$/u.exec(value.trim());
  if (match === null) return undefined;
  const amountText = match[1];
  const unit = match[2];
  if (amountText === undefined) return undefined;
  const amount = Number(amountText);
  if (!Number.isFinite(amount)) return undefined;
  if (unit === "ms") return amount / 1_000;
  return amount;
}
