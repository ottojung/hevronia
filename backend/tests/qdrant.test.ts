import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isQdrantUnavailableError,
  waitForQdrantReady,
} from "../src/long-term-memory/qdrant.js";

function controlledTime(): {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
} {
  let currentTime = 0;
  return {
    now: () => currentTime,
    sleep: async (milliseconds) => {
      currentTime += milliseconds;
    },
  };
}

test("Qdrant readiness resolves after an immediate HTTP 200", async () => {
  let requestedUrl = "";
  await waitForQdrantReady("http://qdrant.test:6333/", {
    fetchImpl: async (input) => {
      requestedUrl = input.toString();
      return new Response(undefined, { status: 200 });
    },
  });
  assert.equal(requestedUrl, "http://qdrant.test:6333/readyz");
});

test("Qdrant readiness retries connection errors and non-200 responses", async () => {
  const time = controlledTime();
  let attempts = 0;
  await waitForQdrantReady("http://qdrant.test:6333", {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new TypeError("connection refused"));
      }
      return new Response(undefined, { status: attempts === 2 ? 503 : 200 });
    },
    sleepImpl: time.sleep,
    nowImpl: time.now,
    timeoutMs: 10,
    pollMs: 1,
  });
  assert.equal(attempts, 3);
});

test("Qdrant readiness returns a dedicated error after its deadline", async () => {
  const time = controlledTime();
  await assert.rejects(
    () =>
      waitForQdrantReady("http://qdrant.test:6333", {
        fetchImpl: async () => new Response(undefined, { status: 503 }),
        sleepImpl: time.sleep,
        nowImpl: time.now,
        timeoutMs: 2,
        pollMs: 1,
      }),
    isQdrantUnavailableError,
  );
});
