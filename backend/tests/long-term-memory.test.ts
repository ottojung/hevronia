import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { createConversationLayer } from "../src/layer.js";
import { extractText } from "../src/text.js";
import {
  createMem0Config,
  LONG_TERM_MEMORY_TOP_K,
  type LongTermMemory,
  type RecalledMemory,
} from "../src/long-term-memory/index.js";
import { LONG_TERM_MEMORY_POLICY } from "../src/long-term-memory/policy.js";
import { PendingMemoryWrites } from "../src/long-term-memory/pending.js";

interface SearchCall {
  userId: string;
  query: string;
  topK: number;
}

interface RememberCall {
  userId: string;
  threadId: string;
  userMessage: string;
  assistantMessage: string;
}

class DeferredWrite {
  readonly promise: Promise<void>;
  private resolve: (() => void) | undefined;

  constructor() {
    this.promise = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  finish(): void {
    this.resolve?.();
  }
}

class FakeLongTermMemory implements LongTermMemory {
  readonly searchCalls: SearchCall[] = [];
  readonly rememberCalls: RememberCall[] = [];
  readonly memoriesByUser = new Map<string, RecalledMemory[]>();
  searchFailure: Error | undefined;
  rememberFailure: Error | undefined;
  rememberPromise: Promise<void> | undefined;

  async search(userId: string, query: string, topK: number): Promise<RecalledMemory[]> {
    this.searchCalls.push({ userId, query, topK });
    if (this.searchFailure !== undefined) {
      throw this.searchFailure;
    }
    return this.memoriesByUser.get(userId) ?? [];
  }

  async deleteAll(_userId: string): Promise<void> {}

  async rememberTurn(
    userId: string,
    threadId: string,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    this.rememberCalls.push({ userId, threadId, userMessage, assistantMessage });
    if (this.rememberFailure !== undefined) {
      throw this.rememberFailure;
    }
    await this.rememberPromise;
  }
}

function fixture(
  memory: LongTermMemory,
  systemPrompt?: string,
  pendingMemoryWrites?: PendingMemoryWrites,
): {
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
    longTermMemory: memory,
    systemPrompt,
    pendingMemoryWrites,
  });
  return { dir, model, layer };
}

test("retrieval uses top five and reaches the model through ephemeral system context", async () => {
  const sentinel = "BASE_SYSTEM_PROMPT_SENTINEL";
  const memory = new FakeLongTermMemory();
  memory.memoriesByUser.set("telegram-user:111", [
    { text: "User's favourite colour is purple." },
  ]);
  const { dir, model, layer } = fixture(memory, sentinel);
  try {
    model.respond((messages) => {
      const visibleText = messages.map((message) => extractText(message.content)).join("\n");
      assert.equal(visibleText.split(sentinel).length - 1, 1);
      assert.equal(visibleText.split("favourite colour is purple").length - 1, 1);
      return new AIMessage("Фіолетовий.");
    });
    await layer.respond({
      threadId: "thread-a",
      userId: "telegram-user:111",
      messageText: "Який колір мені пасує?",
    });
    assert.equal(memory.searchCalls[0]?.topK, LONG_TERM_MEMORY_TOP_K);

    const checkpointText = (await layer.getMessages("thread-a"))
      .map((message) => String(message.content))
      .join("\n");
    assert.ok(!checkpointText.includes("favourite colour is purple"));
    await layer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("users are isolated while one user can share memory across separate threads", async () => {
  const memory = new FakeLongTermMemory();
  memory.memoriesByUser.set("telegram-user:111", [{ text: "private memory for 111" }]);
  const { dir, model, layer } = fixture(memory);
  try {
    model.respond((messages) => {
      assert.ok(messages.map((message) => extractText(message.content)).join("\n").includes("private memory for 111"));
      return new AIMessage("one");
    });
    model.respond((messages) => {
      assert.ok(messages.map((message) => extractText(message.content)).join("\n").includes("private memory for 111"));
      return new AIMessage("two");
    });
    model.respond((messages) => {
      assert.ok(!messages.map((message) => extractText(message.content)).join("\n").includes("private memory for 111"));
      return new AIMessage("other user");
    });

    await layer.respond({ threadId: "thread-a", userId: "telegram-user:111", messageText: "a" });
    await layer.respond({ threadId: "thread-b", userId: "telegram-user:111", messageText: "b" });
    await layer.respond({ threadId: "thread-c", userId: "telegram-user:222", messageText: "c" });

    assert.deepEqual(
      memory.searchCalls.map(({ userId }) => userId),
      ["telegram-user:111", "telegram-user:111", "telegram-user:222"],
    );
    assert.equal((await layer.getMessages("thread-a")).length, 2);
    assert.equal((await layer.getMessages("thread-b")).length, 2);
    await layer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("successful turns are offered for storage exactly once", async () => {
  const memory = new FakeLongTermMemory();
  const { dir, model, layer } = fixture(memory);
  try {
    model.respond(new AIMessage("assistant reply"));
    const turn = await layer.respond({ threadId: "thread-a", userId: "user-a", messageText: "user text" });
    assert.equal(memory.rememberCalls.length, 0);
    await turn.postSend();
    assert.deepEqual(memory.rememberCalls, [
      {
        userId: "user-a",
        threadId: "thread-a",
        userMessage: "user text",
        assistantMessage: "assistant reply",
      },
    ]);
    await layer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("generation returns before post-send ingestion and undelivered turns are not stored", async () => {
  const memory = new FakeLongTermMemory();
  const pendingWrite = new DeferredWrite();
  memory.rememberPromise = pendingWrite.promise;
  const tracker = new PendingMemoryWrites();
  const { dir, model, layer } = fixture(memory, undefined, tracker);
  try {
    model.respond(new AIMessage("delivered reply"));
    const deliveredTurn = await layer.respond({
      threadId: "delivered",
      userId: "user-a",
      messageText: "hello",
    });
    assert.equal(deliveredTurn.replyText, "delivered reply");
    assert.equal(memory.rememberCalls.length, 0);

    model.respond(new AIMessage("undelivered reply"));
    await layer.respond({ threadId: "failed-send", userId: "user-a", messageText: "again" });
    assert.equal(memory.rememberCalls.length, 0);

    let writeCompleted = false;
    void deliveredTurn.postSend().then(() => {
      writeCompleted = true;
    });
    assert.equal(memory.rememberCalls.length, 1);
    await Promise.resolve();
    assert.equal(writeCompleted, false);
    pendingWrite.finish();
    await tracker.drain();
    assert.equal(writeCompleted, true);
    await layer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shutdown drains a tracked post-send write", async () => {
  const memory = new FakeLongTermMemory();
  const pendingWrite = new DeferredWrite();
  memory.rememberPromise = pendingWrite.promise;
  const tracker = new PendingMemoryWrites();
  const { dir, model, layer } = fixture(memory, undefined, tracker);
  try {
    model.respond(new AIMessage("reply"));
    const turn = await layer.respond({ threadId: "thread", userId: "user", messageText: "hello" });
    const postSend = turn.postSend();
    let closed = false;
    const close = layer.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    assert.equal(closed, false);
    pendingWrite.finish();
    await Promise.all([postSend, close]);
    assert.equal(closed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failed generation is not offered for long-term storage", async () => {
  const memory = new FakeLongTermMemory();
  const { dir, model, layer } = fixture(memory);
  try {
    model.respond(new Error("generation failed"));
    await assert.rejects(() =>
      layer.respond({ threadId: "thread-a", userId: "user-a", messageText: "hello" }),
    );
    assert.equal(memory.rememberCalls.length, 0);
    await layer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search and ingestion failures independently degrade gracefully", async () => {
  const memory = new FakeLongTermMemory();
  memory.searchFailure = new Error("search failed");
  memory.rememberFailure = new Error("write failed");
  const { dir, model, layer } = fixture(memory);
  try {
    model.respond((messages) => {
      assert.ok(!messages.map((message) => extractText(message.content)).join("\n").includes("Long-term memories that may"));
      return new AIMessage("valid reply");
    });
    const reply = await layer.respond({
      threadId: "thread-a",
      userId: "user-a",
      messageText: "hello",
    });
    assert.equal(reply.replyText, "valid reply");
    assert.equal(memory.rememberCalls.length, 0);
    await reply.postSend();
    assert.equal(memory.rememberCalls.length, 1);
    await layer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Mem0 production configuration carries the extraction policy and explicit credentials", () => {
  const config = createMem0Config("test-key", "http://qdrant.test:6333");
  assert.equal(config.customInstructions, LONG_TERM_MEMORY_POLICY);
  assert.equal(config.llm.config.apiKey, "test-key");
  assert.equal(config.embedder.config.apiKey, "test-key");
  assert.equal(config.vectorStore.provider, "qdrant");
  assert.equal(config.vectorStore.config["url"], "http://qdrant.test:6333");
  assert.equal(config.vectorStore.config["path"], undefined);
});
