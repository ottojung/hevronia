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
  longTermMemoryStoreFromMem0,
  memoryRecordsFromItems,
  type Mem0Client,
  type MemoryRecord,
} from "../src/long-term-memory/index.js";
import {
  createLazyLongTermMemory,
  MEMORY_WARM_QUERY,
  type LazyLongTermMemory,
} from "../src/long-term-memory/runtime.js";
import { LONG_TERM_MEMORY_POLICY, MEMORY_POLICY_VERSION } from "../src/long-term-memory/policy.js";
import {
  conversationThreadIdFromTelegramPrivateChat,
  longTermMemoryUserIdFromTelegramSender,
} from "../src/identifiers.js";
import { FakeScheduler, FakeStore, deferred, fact, silenceDecision } from "./memory-fixtures.js";
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
      action: "speak",
      addressCharacter: "P1",
      replyToMessage: null,
      interpretation: "This person is sharing a personal concern.",
      feltState: "This leaves you mildly attentive.",
      activeDesire: "You want to understand better.",
      desiredOutcome: "You want to know what is actually going on.",
      opportunity: "You notice they are still here to talk.",
      pursuit: "You decide to ask a direct question.",
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

test("the Mem0 adapter searches with TypeScript userId filters, preserving topK", async () => {
  const captured: Parameters<Mem0Client["search"]>[] = [];
  const client: Mem0Client = {
    search: async (query, options) => {
      captured.push([query, options]);
      return { results: [] };
    },
    add: async () => ({ results: [] }),
    deleteAll: async () => ({ message: "deleted" }),
  };
  const store = longTermMemoryStoreFromMem0(client);
  await store.search(longTermMemoryUserIdFromTelegramSender(777), "питання", 5);
  const call = captured[0];
  assert.ok(call !== undefined);
  const [query, options] = call;
  assert.equal(query, "питання");
  assert.equal(options.topK, 5);
  assert.ok(options.filters !== undefined);
  assert.equal(options.filters["userId"], "telegram-user:777");
  assert.equal("user_id" in options.filters, false);
});

test("the Mem0 adapter passes add metadata, maps extraction results, and scopes deleteAll", async () => {
  const addCalls: Parameters<Mem0Client["add"]>[] = [];
  const deleteCalls: Parameters<Mem0Client["deleteAll"]>[] = [];
  const client: Mem0Client = {
    search: async () => ({ results: [] }),
    add: async (messages, options) => {
      addCalls.push([messages, options]);
      return { results: [{ id: "m1", memory: "extracted fact" }] };
    },
    deleteAll: async (options) => {
      deleteCalls.push([options]);
      return { message: "deleted" };
    },
  };
  const store = longTermMemoryStoreFromMem0(client);
  const userId = longTermMemoryUserIdFromTelegramSender(555);
  const threadId = conversationThreadIdFromTelegramPrivateChat(2);
  const records = await store.rememberUserMessage(userId, threadId, "я люблю чай");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.id, "m1");
  assert.equal(records[0]?.text, "extracted fact");
  const addCall = addCalls[0];
  assert.ok(addCall !== undefined);
  const [, options] = addCall;
  assert.equal(options.userId, "telegram-user:555");
  assert.equal(options.metadata?.["source"], "telegram");
  assert.equal(options.metadata?.["threadId"], "telegram-private:2");
  await store.deleteAll(userId);
  const deleteCall = deleteCalls[0];
  assert.ok(deleteCall !== undefined);
  assert.equal(deleteCall[0].userId, "telegram-user:555");
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
  assert.match(LONG_TERM_MEMORY_POLICY, /Favourite colour is purple\./);
  assert.match(LONG_TERM_MEMORY_POLICY, /Does not live near Oakridge\./);
  assert.doesNotMatch(LONG_TERM_MEMORY_POLICY, /User's/);
  assert.doesNotMatch(LONG_TERM_MEMORY_POLICY, /\bUser\b/);
});

test("the extraction policy version is bumped to reflect subject-relative memories", async () => {
  assert.equal(MEMORY_POLICY_VERSION, 2);
  const client: Mem0Client = {
    search: async () => ({ results: [] }),
    add: async (_messages, options) => {
      assert.equal(options.metadata?.["memoryPolicyVersion"], 2);
      return { results: [] };
    },
    deleteAll: async () => ({ message: "deleted" }),
  };
  const adapter = longTermMemoryStoreFromMem0(client);
  await adapter.rememberUserMessage(
    longTermMemoryUserIdFromTelegramSender(1),
    conversationThreadIdFromTelegramPrivateChat(9),
    "я люблю чай",
  );
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
      message: observedMessage("hello", 1), hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    if (turn.outcome.action === "silence") assert.fail("expected a speak");
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
    return silenceDecision();
  } };
  const { dir, layer } = fixture({ lazyMemory: memory, decisionMaker: planner });
  try {
    await layer.respond({ threadId, message: observedMessage("hello", 1),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await scheduler.fireAll();
    await layer.respond({ threadId, message: observedMessage("again", 2),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
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
  store.rememberImpl = () => [fact("l1", "Favourite colour is purple.")];
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10 });
  const seen: string[][] = [];
  const planner: SocialDecisionMaker = { decide: async (context) => {
    seen.push(context.participantMemories.flatMap(({ memories }) => memories.map(({ text }) => text)));
    return silenceDecision();
  } };
  const { dir, layer } = fixture({ lazyMemory: memory, decisionMaker: planner });
  try {
    await layer.respond({ threadId,
      message: observedMessage("my favourite colour is purple", 1),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.deepEqual(seen[0], []);
    await scheduler.fireAll();
    await layer.respond({ threadId, message: observedMessage("again", 2),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.deepEqual(seen[1], ["Favourite colour is purple."]);
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
    decisionMaker: { decide: async () => silenceDecision() } });
  try {
    const turn = await layer.respond({ threadId, message: observedMessage("ambient", 1, 111),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
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
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    if (turn.outcome.action === "silence") assert.fail("expected a speak");
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
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false }));
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
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    if (turn.outcome.action === "speak") turn.outcome.persistDelivery(500);
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
    decisionMaker: { decide: async () => silenceDecision() } });
  try {
    await layer.respond({ threadId, message: observedMessage("з каналу", 1, 0, "chat"),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await scheduler.fireAll();
    assert.equal(store.searchCalls.length, 0);
    assert.equal(store.rememberCalls.length, 0);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bot-authored text is not person-memory evidence but still reaches canonical conversation", async () => {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  store.searchImpl = () => [];
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10 });
  const { dir, layer } = fixture({ lazyMemory: memory,
    decisionMaker: { decide: async () => silenceDecision() } });
  try {
    await layer.respond({ threadId, message: observedMessage("з бота", 1, 101),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: true });
    await scheduler.fireAll();
    assert.equal(store.searchCalls.length, 0);
    assert.equal(store.rememberCalls.length, 0);
    const stored = await layer.getMessages(threadId);
    assert.equal(stored.length, 1);
    assert.match(String(stored[0]?.content), /з бота/);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("human-authored text remains person-memory evidence at the boundary", async () => {
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  store.searchImpl = () => [];
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 10 });
  const { dir, layer } = fixture({ lazyMemory: memory,
    decisionMaker: { decide: async () => silenceDecision() } });
  try {
    await layer.respond({ threadId, message: observedMessage("з людини", 1, 101),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await scheduler.fireAll();
    assert.equal(store.rememberCalls.length, 1);
    assert.equal(store.rememberCalls[0]?.text, "з людини");
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
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await scheduler.fireAll();
    if (turn.outcome.action === "silence") assert.fail("expected a speak");
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
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    if (reply.outcome.action === "silence") assert.fail("expected a speak");
    assert.equal(reply.outcome.replyText, "valid reply");
    await scheduler.fireAll();
    assert.equal(store.rememberCalls.length, 1);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
