import assert from "node:assert/strict";
import { test } from "node:test";

import { GoogleGenerativeAIFetchError } from "@google/generative-ai";
import { RateLimitError } from "openai";

import { isReactionCancelledError } from "../src/reaction-cancelled.js";
import {
  invokeWithRateLimitRetry,
  isRateLimitError,
  rateLimitRetryDelayMs,
} from "../src/model-retry.js";

function openAiRateLimit(headers?: Headers): RateLimitError {
  return new RateLimitError(429, { code: "rate_limit_exceeded" },
    "You exceeded your current quota", headers ?? new Headers());
}

test("isRateLimitError recognizes OpenAI and Google rate-limit errors", () => {
  assert.equal(isRateLimitError(openAiRateLimit()), true);
  assert.equal(
    isRateLimitError(new GoogleGenerativeAIFetchError("RESOURCE_EXHAUSTED", 429)),
    true,
  );
  assert.equal(isRateLimitError(new Error("upstream 429 rate limit")), true);
  assert.equal(isRateLimitError(new Error("server boom")), false);
});

test("isRateLimitError follows an error cause chain", () => {
  const nested = new Error("inner problem", { cause: openAiRateLimit() });
  const wrapped = new Error("outer failure", { cause: nested });
  assert.equal(isRateLimitError(wrapped), true);
});

test("rateLimitRetryDelayMs honors the OpenAI retry-after header and caps at 24 hours", () => {
  assert.equal(
    rateLimitRetryDelayMs(openAiRateLimit(new Headers({ "retry-after": "5" })), 2_000),
    5_000,
  );
  assert.equal(
    rateLimitRetryDelayMs(openAiRateLimit(new Headers({ "retry-after": "300" })), 2_000),
    300_000,
  );
  assert.equal(
    rateLimitRetryDelayMs(
      openAiRateLimit(new Headers({ "retry-after": String(3 * 24 * 60 * 60) })),
      2_000,
    ),
    24 * 60 * 60 * 1_000,
  );
  assert.equal(rateLimitRetryDelayMs(openAiRateLimit(), 2_000), 2_000);
});

test("rateLimitRetryDelayMs parses the Google retryDelay detail", () => {
  const google = new GoogleGenerativeAIFetchError("RESOURCE_EXHAUSTED", 429, "Too Many Requests", [
    { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3.5s" },
  ]);
  assert.equal(rateLimitRetryDelayMs(google, 2_000), 3_500);
  assert.equal(rateLimitRetryDelayMs(new GoogleGenerativeAIFetchError("RESOURCE_EXHAUSTED", 429),
    2_000), 2_000);
});

test("retry re-invokes a rate-limited operation until it succeeds", async () => {
  let attempts = 0;
  const result = await invokeWithRateLimitRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw openAiRateLimit();
    return "ok";
  }, { baseDelayMs: 0 });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("retry has no attempt limit and keeps going past many failures", async () => {
  let attempts = 0;
  const result = await invokeWithRateLimitRetry(async () => {
    attempts += 1;
    if (attempts < 7) throw openAiRateLimit();
    return "ok";
  }, { baseDelayMs: 0 });
  assert.equal(result, "ok");
  assert.equal(attempts, 7);
});

test("non-rate-limit errors are not retried", async () => {
  let attempts = 0;
  await assert.rejects(() => invokeWithRateLimitRetry(async () => {
    attempts += 1;
    throw new Error("boom");
  }, { baseDelayMs: 0 }), /boom/);
  assert.equal(attempts, 1);
});

test("transient transport failures are retried like rate limits", async () => {
  let attempts = 0;
  const result = await invokeWithRateLimitRetry(async () => {
    attempts += 1;
    if (attempts < 2) throw new Error("ECONNRESET socket hang up");
    return "ok";
  }, { baseDelayMs: 0 });
  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("an already-aborted signal cancels before any invocation", async () => {
  const controller = new AbortController();
  controller.abort();
  let attempts = 0;
  try {
    await invokeWithRateLimitRetry(async () => { attempts += 1; return "ok"; },
      { signal: controller.signal });
    assert.fail("expected cancellation");
  } catch (error) {
    assert.equal(isReactionCancelledError(error), true);
  }
  assert.equal(attempts, 0);
});

test("an abort during the retry wait stops retrying immediately", async () => {
  const controller = new AbortController();
  let attempts = 0;
  const pending = invokeWithRateLimitRetry(async () => {
    attempts += 1;
    throw openAiRateLimit();
  }, { signal: controller.signal, baseDelayMs: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  try {
    await pending;
    assert.fail("expected cancellation");
  } catch (error) {
    assert.equal(isReactionCancelledError(error), true);
  }
  assert.equal(attempts, 1, "a cancelled request is never retried");
});

test("an AbortError from the operation is not retried", async () => {
  let attempts = 0;
  try {
    await invokeWithRateLimitRetry(async () => {
      attempts += 1;
      const error = new Error("cancelled");
      error.name = "AbortError";
      throw error;
    }, { baseDelayMs: 0 });
    assert.fail("expected cancellation");
  } catch (error) {
    assert.equal(isReactionCancelledError(error), true);
  }
  assert.equal(attempts, 1);
});
