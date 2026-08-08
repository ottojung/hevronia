import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fakeModel } from "@langchain/core/testing";
import { AIMessage } from "@langchain/core/messages";

import { createConversationLayer, SUMMARY_PREFIX } from "../src/memory.js";

function tempDbPath(): { dir: string; path: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-memory-"));
  return { dir, path: path.join(dir, "checkpoints.sqlite") };
}

test("thread continuity: a second turn sees the first turn", async () => {
  const { dir, path } = tempDbPath();
  try {
    const model = fakeModel();
    const summary = fakeModel();
    const layer = createConversationLayer({ dbPath: path, model, summaryModel: summary });

    model.respond((messages) => new AIMessage(`saw ${messages.length} messages`));
    assert.equal((await layer.respond({ threadId: "thread-a", userId: "test-user", messageText: "перше повідомлення" })).replyText, "saw 2 messages");

    model.respond((messages) => new AIMessage(`saw ${messages.length} messages`));
    assert.equal((await layer.respond({ threadId: "thread-a", userId: "test-user", messageText: "друге повідомлення" })).replyText, "saw 4 messages");

    const messages = await layer.getMessages("thread-a");
    assert.equal(messages.length, 4);
    assert.equal(messages[0]?.content, "перше повідомлення");
    assert.equal(messages[2]?.content, "друге повідомлення");
    await layer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("thread isolation: different chats do not share context", async () => {
  const { dir, path } = tempDbPath();
  try {
    const model = fakeModel();
    const summary = fakeModel();
    const layer = createConversationLayer({ dbPath: path, model, summaryModel: summary });

    model.respond(new AIMessage("reply 111"));
    await layer.respond({ threadId: "telegram-private:111", userId: "test-user", messageText: "hello from 111" });

    model.respond(new AIMessage("reply 222"));
    await layer.respond({ threadId: "telegram-private:222", userId: "test-user", messageText: "hello from 222" });

    model.respond((messages) => new AIMessage(`saw ${messages.length} messages`));
    const reply = await layer.respond({ threadId: "telegram-private:111", userId: "test-user", messageText: "again from 111" });
    assert.equal(reply.replyText, "saw 4 messages");

    const messages = await layer.getMessages("telegram-private:111");
    const text = messages.map((m) => m.content).join("\n");
    assert.ok(!text.includes("hello from 222"));
    await layer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persistence: state survives layer recreation", async () => {
  const { dir, path } = tempDbPath();
  try {
    const firstModel = fakeModel();
    firstModel.respond(new AIMessage("запам'ятано: манго"));
    const firstLayer = createConversationLayer({ dbPath: path, model: firstModel, summaryModel: fakeModel() });
    await firstLayer.respond({ threadId: "thread-p", userId: "test-user", messageText: "Мій улюблений фрукт — манго." });
    await firstLayer.close();

    const secondModel = fakeModel();
    secondModel.respond((messages) => new AIMessage(`saw ${messages.length} messages`));
    const secondLayer = createConversationLayer({ dbPath: path, model: secondModel, summaryModel: fakeModel() });
    const reply = await secondLayer.respond({ threadId: "thread-p", userId: "test-user", messageText: "Який мій улюблений фрукт?" });
    assert.equal(reply.replyText, "saw 4 messages");

    const messages = await secondLayer.getMessages("thread-p");
    assert.equal(messages.length, 4);
    assert.equal(messages[0]?.content, "Мій улюблений фрукт — манго.");
    await secondLayer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compaction: older messages are summarized, recent messages stay verbatim", async () => {
  const { dir, path } = tempDbPath();
  try {
    const model = fakeModel();
    const summary = fakeModel();
    const layer = createConversationLayer({
      dbPath: path,
      model,
      summaryModel: summary,
      triggerTokens: 20,
      keepTokens: 30,
      trimTokensToSummarize: 50,
    });

    for (let i = 0; i < 8; i += 1) {
      model.respond(new AIMessage(`коротка відповідь ${i}`));
    }
    for (let i = 0; i < 20; i += 1) {
      summary.respond(new AIMessage("continuity note: user said their favourite fruit is mango"));
    }

    for (let i = 0; i < 8; i += 1) {
      await layer.respond({ threadId: "thread-c", userId: "test-user", messageText: `улюблений фрукт манго повідомлення номер ${i}` });
    }

    const messages = await layer.getMessages("thread-c");
    assert.ok(messages.length < 16, `expected compaction, but state has ${messages.length} messages`);

    const summaryMessage = messages.find(
      (m) => m.additional_kwargs?.["lc_source"] === "summarization",
    );
    assert.ok(summaryMessage, "expected a summary message after compaction");
    const summaryText = String(summaryMessage.content);
    assert.ok(summaryText.startsWith(SUMMARY_PREFIX));
    assert.ok(summaryText.includes("continuity note"));

    const lastMessage = messages.at(-1);
    if (!(lastMessage instanceof AIMessage)) {
      assert.fail("expected the last message to be an AI message");
    }
    assert.equal(lastMessage.content, "коротка відповідь 7");

    const allText = messages.map((m) => m.content).join("|");
    assert.ok(allText.includes("номер 7"), "newest user message should remain verbatim");
    await layer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failure does not write a fake assistant reply into memory", async () => {
  const { dir, path } = tempDbPath();
  try {
    const model = fakeModel();
    const summary = fakeModel();
    const layer = createConversationLayer({ dbPath: path, model, summaryModel: summary });

    model.respond(new Error("openai boom"));
    await assert.rejects(() => layer.respond({ threadId: "thread-f", userId: "test-user", messageText: "привіт" }));

    model.respond(new AIMessage("відповідь після збою"));
    const reply = await layer.respond({ threadId: "thread-f", userId: "test-user", messageText: "знову привіт" });
    assert.equal(reply.replyText, "відповідь після збою");

    const messages = await layer.getMessages("thread-f");
    const assistantTexts = messages
      .filter((m) => m instanceof AIMessage)
      .map((m) => m.content);
    assert.deepEqual(assistantTexts, ["відповідь після збою"]);
    await layer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
