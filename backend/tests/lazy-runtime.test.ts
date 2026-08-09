import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type LongTermMemoryUserId,
  longTermMemoryUserIdFromTelegramSender,
  conversationThreadIdFromTelegramPrivateChat,
} from "../src/identifiers.js";
import {
  MEMORY_WARM_QUERY,
  createLazyLongTermMemory,
  type LazyLongTermMemory,
  type LazyLongTermMemoryOptions,
} from "../src/long-term-memory/runtime.js";
import type { MemoryRecord } from "../src/long-term-memory/index.js";
import { FakeScheduler, FakeStore, deferred, fact } from "./memory-fixtures.js";

const userId = longTermMemoryUserIdFromTelegramSender(101);
const otherUserId = longTermMemoryUserIdFromTelegramSender(202);
const threadId = conversationThreadIdFromTelegramPrivateChat(1);

function createMemory(overrides: Partial<LazyLongTermMemoryOptions> = {}): {
  memory: LazyLongTermMemory;
  store: FakeStore;
  scheduler: FakeScheduler;
  advance: (ms: number) => void;
} {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  let time = 0;
  const memory = createLazyLongTermMemory({
    store,
    scheduler,
    now: () => time,
    idleDelayMs: 10,
    ...overrides,
  });
  return { memory, store, scheduler, advance: (ms) => { time += ms; } };
}

test("beginTurn returns the currently cached memories synchronously", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = () => [fact("m1", "durable fact")];
  memory.warmUser(userId);
  await scheduler.fireAll();
  const turn = memory.beginTurn();
  assert.deepEqual(turn.snapshot.memoriesFor(userId), [{ text: "durable fact" }]);
  turn.release();
  await memory.close();
});

test("a turn snapshot stays immutable when background work later changes the cache", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = () => [fact("m1", "baseline fact")];
  memory.warmUser(userId);
  await scheduler.fireAll();
  const turn = memory.beginTurn();
  store.searchImpl = () => [fact("m1", "baseline fact"), fact("m2", "topical fact")];
  memory.observeUserMessage(userId, threadId, "hello");
  turn.release();
  await scheduler.fireAll();
  assert.deepEqual(turn.snapshot.memoriesFor(userId), [{ text: "baseline fact" }]);
  const next = memory.beginTurn();
  assert.deepEqual(next.snapshot.memoriesFor(userId).map(({ text }) => text).sort(),
    ["baseline fact", "topical fact"]);
  next.release();
  await memory.close();
});

test("no background Mem0 call starts while a foreground lease is held", async () => {
  const { memory, store, scheduler } = createMemory();
  const turn = memory.beginTurn();
  memory.observeUserMessage(userId, threadId, "hello");
  assert.equal(store.searchCalls.length, 0);
  assert.equal(store.rememberCalls.length, 0);
  assert.equal(scheduler.count, 0);
  turn.release();
  await memory.close();
});

test("releasing the last foreground lease lets queued work begin after the idle delay", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = () => [fact("m1", "fact")];
  const turn = memory.beginTurn();
  memory.observeUserMessage(userId, threadId, "hello");
  turn.release();
  assert.equal(store.searchCalls.length, 0);
  scheduler.fireEarliest();
  assert.ok(store.searchCalls.length > 0);
  await memory.close();
});

test("two concurrent foreground leases prevent background startup until both release", async () => {
  const { memory, store, scheduler } = createMemory();
  const first = memory.beginTurn();
  const second = memory.beginTurn();
  memory.observeUserMessage(userId, threadId, "hello");
  first.release();
  assert.equal(store.searchCalls.length, 0);
  assert.equal(scheduler.count, 0);
  second.release();
  await scheduler.fireAll();
  assert.ok(store.searchCalls.length > 0);
  await memory.close();
});

test("background concurrency never exceeds one", async () => {
  const { memory, store, scheduler } = createMemory();
  for (let index = 0; index < 10; index += 1) {
    memory.observeUserMessage(userId, threadId, `message ${index}`);
  }
  await scheduler.fireAll();
  assert.ok(store.searchCalls.length > 0);
  assert.equal(store.maxActiveSearches, 1);
  assert.equal(store.rememberCalls.length, 10);
  await memory.close();
});

test("an already-running memory operation is allowed to finish if a new foreground turn starts", async () => {
  const { memory, store, scheduler } = createMemory();
  const pendingSearch = deferred<MemoryRecord[]>();
  let topicalCalls = 0;
  store.searchImpl = (_key, query) => {
    if (query === MEMORY_WARM_QUERY) return [fact("w1", "warm")];
    topicalCalls += 1;
    return pendingSearch.promise;
  };
  memory.warmUser(userId);
  memory.observeUserMessage(userId, threadId, "hello");
  await scheduler.fireAll();
  assert.equal(topicalCalls, 1);
  const turn = memory.beginTurn();
  pendingSearch.resolve([fact("t1", "topical")]);
  await Promise.resolve();
  assert.equal(topicalCalls, 1);
  turn.release();
  await memory.close();
});

test("warm requests for the same fresh user are deduplicated", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = () => [fact("m1", "fact")];
  memory.warmUser(userId);
  memory.warmUser(userId);
  memory.warmUser(userId);
  await scheduler.fireAll();
  const warmCalls = store.searchCalls.filter(({ query }) => query === MEMORY_WARM_QUERY);
  assert.equal(warmCalls.length, 1);
  await memory.close();
});

test("warm TTL uses the injected clock", async () => {
  const { memory, store, scheduler, advance } = createMemory({ warmTtlMs: 1_000 });
  store.searchImpl = () => [fact("m1", "fact")];
  memory.warmUser(userId);
  await scheduler.fireAll();
  assert.equal(store.searchCalls.filter(({ query }) => query === MEMORY_WARM_QUERY).length, 1);
  memory.warmUser(userId);
  assert.equal(store.searchCalls.filter(({ query }) => query === MEMORY_WARM_QUERY).length, 1);
  advance(2_000);
  memory.warmUser(userId);
  await scheduler.fireAll();
  assert.equal(store.searchCalls.filter(({ query }) => query === MEMORY_WARM_QUERY).length, 2);
  await memory.close();
});

test("pending topical queries for the same user coalesce to the newest query", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = () => [fact("m1", "fact")];
  memory.warmUser(userId);
  memory.observeUserMessage(userId, threadId, "message one");
  memory.observeUserMessage(userId, threadId, "message two");
  await scheduler.fireAll();
  const topicalCalls = store.searchCalls.filter(({ query }) => query !== MEMORY_WARM_QUERY);
  assert.equal(topicalCalls.length, 1);
  assert.equal(topicalCalls[0]?.query, "message two");
  await memory.close();
});

test("a running topical query is not cancelled and a newer pending query runs after", async () => {
  const { memory, store, scheduler } = createMemory();
  const firstTopical = deferred<MemoryRecord[]>();
  let topicalCalls = 0;
  store.searchImpl = (_key, query) => {
    if (query === MEMORY_WARM_QUERY) return [fact("w1", "warm")];
    topicalCalls += 1;
    if (topicalCalls === 1) return firstTopical.promise;
    return [fact("t2", "second")];
  };
  memory.warmUser(userId);
  memory.observeUserMessage(userId, threadId, "first query");
  await scheduler.fireAll();
  assert.equal(topicalCalls, 1);
  memory.observeUserMessage(userId, threadId, "second query");
  assert.equal(topicalCalls, 1);
  firstTopical.resolve([fact("t1", "first")]);
  await scheduler.fireAll();
  assert.equal(topicalCalls, 2);
  await memory.close();
});

test("every observed user message is ingested and never coalesced away", async () => {
  const { memory, store, scheduler } = createMemory();
  memory.observeUserMessage(userId, threadId, "one");
  memory.observeUserMessage(userId, threadId, "two");
  memory.observeUserMessage(userId, threadId, "three");
  await scheduler.fireAll();
  assert.deepEqual(store.rememberCalls.map(({ text }) => text), ["one", "two", "three"]);
  await memory.close();
});

test("successful ingestion results appear in the learned cache", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = () => [];
  store.rememberImpl = () => [fact("l1", "learned fact")];
  memory.observeUserMessage(userId, threadId, "hello");
  await scheduler.fireAll();
  const turn = memory.beginTurn();
  assert.deepEqual(turn.snapshot.memoriesFor(userId), [{ text: "learned fact" }]);
  turn.release();
  await memory.close();
});

test("learned, topical, and baseline lanes combine in the required order", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = (_key, query) =>
    query === MEMORY_WARM_QUERY ? [fact("b1", "baseline")] : [fact("t1", "topical")];
  store.rememberImpl = () => [fact("l1", "learned")];
  memory.warmUser(userId);
  memory.observeUserMessage(userId, threadId, "hello");
  await scheduler.fireAll();
  const turn = memory.beginTurn();
  assert.deepEqual(turn.snapshot.memoriesFor(userId).map(({ text }) => text),
    ["learned", "topical", "baseline"]);
  turn.release();
  await memory.close();
});

test("a newly learned correction precedes an older retrieved fact", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = (_key, query) =>
    query === MEMORY_WARM_QUERY
      ? [fact("b1", "Lives in Vancouver.")]
      : [fact("t1", "Lives in Vancouver.")];
  store.rememberImpl = () => [fact("l1", "Lives in Toronto.")];
  memory.warmUser(userId);
  memory.observeUserMessage(userId, threadId, "I moved to Toronto.");
  await scheduler.fireAll();
  const turn = memory.beginTurn();
  assert.deepEqual(turn.snapshot.memoriesFor(userId).map(({ text }) => text),
    ["Lives in Toronto.", "Lives in Vancouver."]);
  turn.release();
  await memory.close();
});

test("memories are deduplicated by id and normalized text", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = (_key, query) =>
    query === MEMORY_WARM_QUERY
      ? [fact("l1", "Something else")]
      : [fact("t1", "Love tea")];
  store.rememberImpl = () => [fact("l1", "love tea"), fact("l2", "Different fact")];
  memory.warmUser(userId);
  memory.observeUserMessage(userId, threadId, "hello");
  await scheduler.fireAll();
  const turn = memory.beginTurn();
  assert.deepEqual(turn.snapshot.memoriesFor(userId).map(({ text }) => text),
    ["love tea", "Different fact"]);
  turn.release();
  await memory.close();
});

test("the visible context is capped at eight memories", async () => {
  const { memory, store, scheduler } = createMemory({ learnedLimit: 8 });
  const many = Array.from({ length: 4 }, (_, index) => fact(`b${index}`, `baseline ${index}`));
  store.searchImpl = (_key, query) =>
    query === MEMORY_WARM_QUERY
      ? many
      : Array.from({ length: 4 }, (_, index) => fact(`t${index}`, `topical ${index}`));
  store.rememberImpl = () =>
    Array.from({ length: 4 }, (_, index) => fact(`l${index}`, `learned ${index}`));
  memory.warmUser(userId);
  memory.observeUserMessage(userId, threadId, "hello");
  await scheduler.fireAll();
  const turn = memory.beginTurn();
  const visible = turn.snapshot.memoriesFor(userId);
  assert.equal(visible.length, 8);
  assert.deepEqual(visible.map(({ text }) => text).slice(0, 4),
    ["learned 0", "learned 1", "learned 2", "learned 3"]);
  assert.deepEqual(visible.map(({ text }) => text).slice(4, 8),
    ["topical 0", "topical 1", "topical 2", "topical 3"]);
  turn.release();
  await memory.close();
});

test("search failures leave old cached values intact and a failed warm does not set a new TTL", async () => {
  const { memory, store, scheduler, advance } = createMemory({ warmTtlMs: 100 });
  const warmCalls = () => store.searchCalls.filter(({ query }) => query === MEMORY_WARM_QUERY).length;
  store.searchImpl = () => [fact("m1", "stable fact")];
  memory.warmUser(userId);
  await scheduler.fireAll();
  assert.equal(warmCalls(), 1);
  advance(200);
  store.searchImpl = () => { throw new Error("search broke"); };
  memory.warmUser(userId);
  await scheduler.fireAll();
  assert.equal(warmCalls(), 2);
  let turn = memory.beginTurn();
  assert.deepEqual(turn.snapshot.memoriesFor(userId), [{ text: "stable fact" }]);
  turn.release();
  advance(50);
  store.searchImpl = () => [fact("m2", "refreshed fact")];
  memory.warmUser(userId);
  await scheduler.fireAll();
  assert.equal(warmCalls(), 3);
  turn = memory.beginTurn();
  assert.deepEqual(turn.snapshot.memoriesFor(userId), [{ text: "refreshed fact" }]);
  turn.release();
  await memory.close();
});

test("a successful empty warm establishes a TTL and timestamp zero works", async () => {
  const { memory, store, scheduler, advance } = createMemory({ warmTtlMs: 100 });
  const warmCalls = () => store.searchCalls.filter(({ query }) => query === MEMORY_WARM_QUERY).length;
  store.searchImpl = () => [];
  memory.warmUser(userId);
  await scheduler.fireAll();
  assert.equal(warmCalls(), 1);
  memory.warmUser(userId);
  await scheduler.fireAll();
  assert.equal(warmCalls(), 1);
  advance(200);
  memory.warmUser(userId);
  await scheduler.fireAll();
  assert.equal(warmCalls(), 2);
  await memory.close();
});

test("ingestion failures leave the turn and cache otherwise healthy", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = () => [fact("m1", "stable fact")];
  store.rememberImpl = () => { throw new Error("ingest broke"); };
  memory.warmUser(userId);
  memory.observeUserMessage(userId, threadId, "hello");
  await scheduler.fireAll();
  const turn = memory.beginTurn();
  assert.deepEqual(turn.snapshot.memoriesFor(userId), [{ text: "stable fact" }]);
  assert.equal(store.rememberCalls.length, 1);
  turn.release();
  await memory.close();
});

test("user caches are isolated by canonical user id", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = (key) => [fact("m1", `memory for ${key}`)];
  memory.warmUser(userId);
  memory.warmUser(otherUserId);
  await scheduler.fireAll();
  const turn = memory.beginTurn();
  assert.deepEqual(turn.snapshot.memoriesFor(userId), [{ text: "memory for telegram-user:101" }]);
  assert.deepEqual(turn.snapshot.memoriesFor(otherUserId),
    [{ text: "memory for telegram-user:202" }]);
  const third: LongTermMemoryUserId = longTermMemoryUserIdFromTelegramSender(303);
  assert.deepEqual(turn.snapshot.memoriesFor(third), []);
  turn.release();
  await memory.close();
});

test("cache eviction does not delete persistent memory", async () => {
  const { memory, store, scheduler, advance } = createMemory({ maxCachedUsers: 2 });
  store.searchImpl = (key) => [fact("m1", `memory for ${key}`)];
  memory.warmUser(userId);
  await scheduler.fireAll();
  advance(10);
  memory.warmUser(otherUserId);
  await scheduler.fireAll();
  advance(10);
  const third: LongTermMemoryUserId = longTermMemoryUserIdFromTelegramSender(303);
  memory.warmUser(third);
  await scheduler.fireAll();
  assert.equal(store.deleteAllCalls.length, 0);
  const turn = memory.beginTurn();
  assert.deepEqual(turn.snapshot.memoriesFor(userId), []);
  assert.deepEqual(turn.snapshot.memoriesFor(otherUserId), [{ text: "memory for telegram-user:202" }]);
  assert.deepEqual(turn.snapshot.memoriesFor(third), [{ text: "memory for telegram-user:303" }]);
  turn.release();
  await memory.close();
});

test("shutdown drains normally when jobs finish and is idempotent", async () => {
  const { memory, store } = createMemory();
  store.searchImpl = () => [fact("m1", "fact")];
  memory.observeUserMessage(userId, threadId, "hello");
  await memory.close();
  await memory.close();
  assert.ok(store.searchCalls.length > 0);
  assert.equal(store.rememberCalls.length, 1);
});

test("draining starts queued work immediately without the grace delay", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = () => [fact("m1", "fact")];
  memory.observeUserMessage(userId, threadId, "hello");
  assert.equal(scheduler.count, 1);
  const closing = memory.close();
  assert.ok(store.searchCalls.length > 0);
  await closing;
  assert.equal(store.rememberCalls.length, 1);
});

test("shutdown timeout discards queued jobs and a later release starts nothing", async () => {
  const { memory, store, scheduler } = createMemory({ shutdownDrainTimeoutMs: 5 });
  const hangingSearch = deferred<MemoryRecord[]>();
  let searchCount = 0;
  store.searchImpl = () => { searchCount += 1; return hangingSearch.promise; };
  memory.observeUserMessage(userId, threadId, "hello");
  const closing = memory.close();
  await Promise.resolve();
  scheduler.fireEarliest();
  await closing;
  assert.equal(searchCount, 1);
  assert.equal(store.rememberCalls.length, 0);
  hangingSearch.resolve([fact("m1", "fact")]);
  await scheduler.fireAll();
  assert.equal(store.rememberCalls.length, 0);
  const turn = memory.beginTurn();
  turn.release();
  await scheduler.fireAll();
  assert.equal(searchCount, 1);
  assert.equal(store.rememberCalls.length, 0);
});

test("close with an active foreground waits only up to the shutdown deadline", async () => {
  const { memory, store, scheduler } = createMemory({ shutdownDrainTimeoutMs: 5 });
  store.searchImpl = () => [fact("m1", "fact")];
  const turn = memory.beginTurn();
  memory.observeUserMessage(userId, threadId, "hello");
  const closing = memory.close();
  await Promise.resolve();
  scheduler.fireEarliest();
  await closing;
  assert.equal(store.searchCalls.length, 0);
  assert.equal(store.rememberCalls.length, 0);
  turn.release();
  await scheduler.fireAll();
  assert.equal(store.searchCalls.length, 0);
  assert.equal(store.rememberCalls.length, 0);
});

test("the idle grace period happens once per foreground-to-background transition, not per job", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = () => [fact("m1", "fact")];
  for (let index = 0; index < 5; index += 1) {
    memory.observeUserMessage(userId, threadId, `message ${index}`);
  }
  assert.equal(scheduler.pending.length, 1);
  await scheduler.fireAll();
  assert.equal(store.rememberCalls.length, 5);
  assert.ok(store.searchCalls.length > 0);
  assert.equal(scheduler.pending.length, 1);
  await memory.close();
});

test("topical retrieval does not begin before the relevant ingestion attempt finishes", async () => {
  const { memory, store, scheduler } = createMemory();
  const pendingIngest = deferred<MemoryRecord[]>();
  store.searchImpl = (_key, query) =>
    query === MEMORY_WARM_QUERY ? [fact("w1", "warm")] : [fact("t1", "topical")];
  store.rememberImpl = () => pendingIngest.promise;
  memory.observeUserMessage(userId, threadId, "hello");
  await scheduler.fireAll();
  const topicalCalls = () => store.searchCalls.filter(({ query }) => query !== MEMORY_WARM_QUERY);
  assert.equal(topicalCalls().length, 0);
  pendingIngest.resolve([fact("l1", "learned")]);
  await scheduler.fireAll();
  assert.equal(topicalCalls().length, 1);
  assert.equal(topicalCalls()[0]?.query, "hello");
  await memory.close();
});

test("beginTurn cancels a pending background-start timer and release restarts a fresh grace", async () => {
  const { memory, store, scheduler } = createMemory();
  store.searchImpl = () => [fact("m1", "fact")];
  memory.observeUserMessage(userId, threadId, "hello");
  assert.equal(scheduler.count, 1);
  const turn = memory.beginTurn();
  assert.equal(scheduler.count, 0);
  assert.equal(store.searchCalls.length, 0);
  turn.release();
  assert.equal(scheduler.count, 1);
  scheduler.fireEarliest();
  assert.ok(store.searchCalls.length > 0);
  await memory.close();
});

test("participant activity synchronously refreshes LRU age", async () => {
  const { memory, store, scheduler, advance } = createMemory({ maxCachedUsers: 2, warmTtlMs: 100_000 });
  store.searchImpl = (key) => [fact("m1", `memory for ${key}`)];
  memory.warmUser(userId);
  await scheduler.fireAll();
  advance(10);
  memory.warmUser(otherUserId);
  await scheduler.fireAll();
  advance(10);
  memory.warmUser(userId);
  await scheduler.fireAll();
  advance(10);
  memory.warmUser(userId);
  await scheduler.fireAll();
  advance(10);
  const third: LongTermMemoryUserId = longTermMemoryUserIdFromTelegramSender(303);
  memory.warmUser(third);
  await scheduler.fireAll();
  const turn = memory.beginTurn();
  assert.deepEqual(turn.snapshot.memoriesFor(userId), [{ text: "memory for telegram-user:101" }]);
  assert.deepEqual(turn.snapshot.memoriesFor(otherUserId), []);
  assert.deepEqual(turn.snapshot.memoriesFor(third), [{ text: "memory for telegram-user:303" }]);
  turn.release();
  await memory.close();
});
