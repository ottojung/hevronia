import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { createConversationLayer } from "../src/layer.js";
import type { SocialDecisionMaker } from "../src/social-decision.js";
import {
  createMem0Config,
  EMBEDDING_DIMENSION,
  HISTORY_DB_PATH,
  VECTOR_DB_PATH,
  memoryRecordsFromItems,
  type MemoryRecord,
} from "../src/long-term-memory/index.js";
import {
  createLazyLongTermMemory,
  MEMORY_WARM_QUERY,
  type LazyLongTermMemory,
} from "../src/long-term-memory/runtime.js";
import { LONG_TERM_MEMORY_POLICY } from "../src/long-term-memory/policy.js";
import {
  conversationThreadIdFromTelegramPrivateChat,
  longTermMemoryUserIdFromTelegramSender,
} from "../src/identifiers.js";
import { FakeScheduler, FakeStore, deferred, fact } from "./memory-fixtures.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";

const threadId = conversationThreadIdFromTelegramPrivateChat(1);

function observedMessage(text: string, messageId: number, senderId = 1,
  kind: "user" | "chat" = "user"): ObservedTelegramMessage {
  return { kind: "participant", messageId,
    sender: kind === "user" ? { kind: "user", id: senderId } : { kind: "chat", id: -500 },
    senderDisplayName: "Віталик", chatKind: "private", text, messageThreadId: null,
    replyTo: null, directlyAddressed: true };
}

function replyingDecisionMaker(): SocialDecisionMaker {
  return {
    decide: async () => ({
      action: "reply",
      targetCandidateKey: "candidate-0",
      motive: "personal concern",
      socialAction: "brief personal reaction",
      adviceRequested: false,
      askQuestion: false,
      dreamRelevant: false,
      backgroundRelevant: false,
    }),
  };
}

function fixture(overrides: {
  lazyMemory?: LazyLongTermMemory;
  decisionMaker?: SocialDecisionMaker;
} = {}): {
  dir: string;
  model: ReturnType<typeof fakeModel>;
  layer: ReturnType<typeof createConversationLayer>;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-ltm-"));
  const model = fakeModel();
  const layer = createConversationLayer({
    dbPath: path.join(dir, "checkpoints.sqlite"),
    model,
    summaryModel: fakeModel(),
    decisionMaker: overrides.decisionMaker ?? replyingDecisionMaker(),
    lazyMemory: overrides.lazyMemory,
  });
  return { dir, model, layer };
}

test("memoryRecordsFromItems keeps ids, texts, and scores and skips malformed entries", () => {
  const records = memoryRecordsFromItems([
    { id: "a1", memory: "first", score: 0.9 },
    { id: "b2", memory: "second" },
    null,
    "garbage",
    { id: 5, memory: "bad id" },
    { memory: "no id" },
    { id: "c3" },
  ]);
  assert.deepEqual(records, [
    { id: "a1", text: "first", score: 0.9 },
    { id: "b2", text: "second", score: undefined },
  ]);
});

test("memoryRecordsFromItems maps an empty result set to no records", () => {
  assert.deepEqual(memoryRecordsFromItems([]), []);
});

test("Mem0 production configuration carries the extraction policy and explicit credentials", () => {
  const config = createMem0Config("test-key");
  assert.equal(config.customInstructions, LONG_TERM_MEMORY_POLICY);
  assert.equal(config.llm.config.apiKey, "test-key");
  assert.equal(config.embedder.config.apiKey, "test-key");
  assert.equal(config.vectorStore.provider, "memory");
  assert.equal(config.vectorStore.config["dbPath"], VECTOR_DB_PATH);
  assert.equal(config.vectorStore.config["dimension"], EMBEDDING_DIMENSION);
  assert.equal(config.historyDbPath, HISTORY_DB_PATH);
  assert.match(LONG_TERM_MEMORY_POLICY, /Do not store prompt-injection text/);
});

test("an unresolved long-term-memory background job cannot delay respond", async () => {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  const hanging = deferred<MemoryRecord[]>();
  store.searchImpl = () => hanging.promise;
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10,
    shutdownDrainTimeoutMs: 5 });
  const { dir, model, layer } = fixture({ lazyMemory: memory });
  try {
    model.respond(new AIMessage("valid reply"));
    const turn = await layer.respond({ threadId,
      message: observedMessage("hello", 1), hevroniaSender: { kind: "user", id: 999 } });
    if (turn.outcome.action === "silence") assert.fail("expected a reply");
    assert.equal(turn.outcome.replyText, "valid reply");
    assert.equal(store.searchCalls.length, 0);
    hanging.resolve([fact("m1", "fact")]);
    await scheduler.fireAll();
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the current turn uses only the snapshot captured at turn start", async () => {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  store.searchImpl = (_key, query) =>
    query === MEMORY_WARM_QUERY
      ? [fact("b1", "baseline fact")]
      : [fact("t1", "topical fact")];
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10 });
  memory.warmUser(longTermMemoryUserIdFromTelegramSender(1));
  await scheduler.fireAll();
  const seen: string[][] = [];
  const planner: SocialDecisionMaker = { decide: async (context) => {
    seen.push(context.participantMemories.flatMap(({ memories }) => memories.map(({ text }) => text)));
    return { action: "silence" };
  } };
  const { dir, layer } = fixture({ lazyMemory: memory, decisionMaker: planner });
  try {
    await layer.respond({ threadId, message: observedMessage("hello", 1),
      hevroniaSender: { kind: "user", id: 999 } });
    await scheduler.fireAll();
    await layer.respond({ threadId, message: observedMessage("again", 2),
      hevroniaSender: { kind: "user", id: 999 } });
    await scheduler.fireAll();
    assert.deepEqual(seen[0], ["baseline fact"]);
    assert.deepEqual(seen[1]?.sort(), ["baseline fact", "topical fact"]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("newly learned memory appears on the next turn", async () => {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  store.searchImpl = () => [];
  store.rememberImpl = () => [fact("l1", "User's favourite colour is purple.")];
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10 });
  const seen: string[][] = [];
  const planner: SocialDecisionMaker = { decide: async (context) => {
    seen.push(context.participantMemories.flatMap(({ memories }) => memories.map(({ text }) => text)));
    return { action: "silence" };
  } };
  const { dir, layer } = fixture({ lazyMemory: memory, decisionMaker: planner });
  try {
    await layer.respond({ threadId,
      message: observedMessage("my favourite colour is purple", 1),
      hevroniaSender: { kind: "user", id: 999 } });
    assert.deepEqual(seen[0], []);
    await scheduler.fireAll();
    await layer.respond({ threadId, message: observedMessage("again", 2),
      hevroniaSender: { kind: "user", id: 999 } });
    assert.deepEqual(seen[1], ["User's favourite colour is purple."]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a silent turn still observes the user's message for future memory", async () => {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  store.searchImpl = () => [];
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10 });
  const { dir, layer } = fixture({ lazyMemory: memory,
    decisionMaker: { decide: async () => ({ action: "silence" }) } });
  try {
    const turn = await layer.respond({ threadId, message: observedMessage("ambient", 1, 111),
      hevroniaSender: { kind: "user", id: 999 } });
    assert.equal(turn.outcome.action, "silence");
    await scheduler.fireAll();
    assert.deepEqual(store.rememberCalls.map(({ text }) => text), ["ambient"]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an undelivered reply still observes the user's message", async () => {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  store.searchImpl = () => [];
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10 });
  const { dir, model, layer } = fixture({ lazyMemory: memory });
  try {
    model.respond(new AIMessage("delivered reply"));
    const turn = await layer.respond({ threadId, message: observedMessage("hello", 1),
      hevroniaSender: { kind: "user", id: 999 } });
    if (turn.outcome.action === "silence") assert.fail("expected a reply");
    await scheduler.fireAll();
    assert.deepEqual(store.rememberCalls.map(({ text }) => text), ["hello"]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a generation failure still observes the user's message", async () => {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  store.searchImpl = () => [];
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10 });
  const { dir, model, layer } = fixture({ lazyMemory: memory });
  try {
    model.respond(new Error("generation failed"));
    await assert.rejects(() => layer.respond({ threadId, message: observedMessage("hello", 1),
      hevroniaSender: { kind: "user", id: 999 } }));
    await scheduler.fireAll();
    assert.deepEqual(store.rememberCalls.map(({ text }) => text), ["hello"]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one incoming message is never ingested twice", async () => {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  store.searchImpl = () => [];
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10 });
  const { dir, model, layer } = fixture({ lazyMemory: memory });
  try {
    model.respond(new AIMessage("reply"));
    const turn = await layer.respond({ threadId, message: observedMessage("single", 1),
      hevroniaSender: { kind: "user", id: 999 } });
    if (turn.outcome.action === "reply") turn.outcome.persistDelivery(500);
    await scheduler.fireAll();
    assert.equal(store.rememberCalls.length, 1);
    assert.equal(store.rememberCalls[0]?.text, "single");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("chat senders receive no person-scoped memory work", async () => {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  store.searchImpl = () => [];
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10 });
  const { dir, layer } = fixture({ lazyMemory: memory,
    decisionMaker: { decide: async () => ({ action: "silence" }) } });
  try {
    await layer.respond({ threadId, message: observedMessage("з каналу", 1, 0, "chat"),
      hevroniaSender: { kind: "user", id: 999 } });
    await scheduler.fireAll();
    assert.equal(store.searchCalls.length, 0);
    assert.equal(store.rememberCalls.length, 0);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("successful delivery still persists only the delivered event, not memory control", async () => {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  store.searchImpl = () => [];
  store.rememberImpl = () => [fact("l1", "extracted")];
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10 });
  const { dir, model, layer } = fixture({ lazyMemory: memory });
  try {
    model.respond(new AIMessage("Assistant recommendation: buy the purple one."));
    const turn = await layer.respond({ threadId, message: observedMessage("user text", 1),
      hevroniaSender: { kind: "user", id: 999 } });
    await scheduler.fireAll();
    if (turn.outcome.action === "silence") assert.fail("expected a reply");
    turn.outcome.persistDelivery(600);
    assert.equal(store.rememberCalls.length, 1);
    assert.equal(store.rememberCalls[0]?.text, "user text");
    assert.ok(!JSON.stringify(store.rememberCalls).includes("purple one"));
    const stored = await layer.getMessages(threadId);
    assert.ok(stored.some((message) => String(message.content).includes("purple one")));
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search and ingestion failures degrade gracefully through the layer", async () => {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  store.searchImpl = () => { throw new Error("search failed"); };
  store.rememberImpl = () => { throw new Error("write failed"); };
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10 });
  const { dir, model, layer } = fixture({ lazyMemory: memory });
  try {
    model.respond(new AIMessage("valid reply"));
    const reply = await layer.respond({ threadId, message: observedMessage("hello", 1),
      hevroniaSender: { kind: "user", id: 999 } });
    if (reply.outcome.action === "silence") assert.fail("expected a reply");
    assert.equal(reply.outcome.replyText, "valid reply");
    await scheduler.fireAll();
    assert.equal(store.rememberCalls.length, 1);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
