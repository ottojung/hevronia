import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { LazyLongTermMemory } from "../src/long-term-memory/runtime.js";
import { createObservedTelegramMessage, telegramSenderIdentity } from "../src/telegram-observation.js";
import { renderDreamEvent } from "../src/dream-render.js";
import { conversationThreadIdFromTelegramGroupChat } from "../src/identifiers.js";
import { filteringPlanner, testLayer } from "./memory-fixtures.js";

test("user and send-as-chat identities remain distinct and chat senders skip memory work", async () => {
  assert.deepEqual(telegramSenderIdentity(777), { kind: "user", id: 777 });
  assert.deepEqual(telegramSenderIdentity(777, -500), { kind: "chat", id: -500 });
  const user = createObservedTelegramMessage({ messageId: 1,
    sender: { kind: "user", id: 101 }, senderDisplayName: "Новини", senderUsername: "news_feed",
    chatKind: "group", text: "від людини", messageThreadId: null,
    mentionsHevronia: false, replyTo: null });
  const sendAsChat = createObservedTelegramMessage({ messageId: 2,
    sender: { kind: "chat", id: -500 }, senderDisplayName: "Новини", senderUsername: null,
    chatKind: "group", text: "від каналу", messageThreadId: null,
    mentionsHevronia: false, replyTo: null });
  assert.match(renderDreamEvent(user), /Your sleeping mind made character 101 say:/);
  assert.match(renderDreamEvent(user), /від людини/);
  assert.doesNotMatch(renderDreamEvent(user), /telegram-user:101/);
  assert.doesNotMatch(renderDreamEvent(user), /user 101/);
  assert.doesNotMatch(renderDreamEvent(user), /spreadsheet/);
  assert.doesNotMatch(renderDreamEvent(user), /message 1/);
  assert.match(renderDreamEvent(sendAsChat), /channel 500/);
  assert.match(renderDreamEvent(sendAsChat), /Your sleeping mind made the Telegram source channel 500 say:/);
  assert.doesNotMatch(renderDreamEvent(sendAsChat), /dream character/);
  assert.doesNotMatch(renderDreamEvent(sendAsChat), /telegram-chat:-500/);
  assert.doesNotMatch(renderDreamEvent(sendAsChat), /-500/);
  assert.doesNotMatch(renderDreamEvent(sendAsChat), /message 2/);
  const calls: string[] = [];
  const memory: LazyLongTermMemory = {
    beginTurn() {
      return { snapshot: { memoriesFor: () => [] }, release() {} };
    },
    warmUser: (userId) => { calls.push(`warm:${userId.toPersistenceKey()}`); },
    observeUserMessage: (userId, _threadId, _text) => {
      calls.push(`observe:${userId.toPersistenceKey()}`);
    },
    close: async () => undefined,
  };
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-sender-"));
  const layer = testLayer(path.join(dir, "db.sqlite"),
    { lazyMemory: memory, planner: filteringPlanner() });
  try {
    const threadId = conversationThreadIdFromTelegramGroupChat(-10);
    await layer.respond({ threadId, message: user,
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await layer.respond({ threadId, message: sendAsChat,
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    layer.warmParticipant({ kind: "chat", id: -700 });
    layer.warmParticipant({ kind: "user", id: 101 });
    await layer.close();
    assert.ok(calls.includes("observe:telegram-user:101"));
    assert.ok(calls.includes("warm:telegram-user:101"));
    assert.ok(calls.every((call) => !call.includes("telegram-chat")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reply relationships preserve a chat target identity", () => {
  const reply = createObservedTelegramMessage({ messageId: 3,
    sender: { kind: "user", id: 101 }, senderDisplayName: "Іра", senderUsername: null,
    chatKind: "group", text: "та ні", messageThreadId: null,
    mentionsHevronia: false, replyTo: { targetMessageId: 2,
      targetSender: { kind: "chat", id: -500 }, targetSenderDisplayName: "Новини",
      targetSenderUsername: null, targetText: "від каналу", targetsHevronia: false } });
  assert.equal(reply.replyTo?.targetSender.kind, "chat");
  const rendered = renderDreamEvent(reply);
  assert.match(rendered, /Your sleeping mind made character 101 reply to the Telegram source channel 500 with:/);
  assert.match(rendered, /та ні/);
  assert.match(rendered, /character 101/);
  assert.doesNotMatch(rendered, /through “channel 500”/);
  assert.doesNotMatch(rendered, /dream character “channel 500”/);
  assert.doesNotMatch(rendered, /telegram-chat:/);
  assert.doesNotMatch(rendered, /message 2/);
  assert.doesNotMatch(rendered, /message 3/);
  assert.doesNotMatch(rendered, /channel -500/);
});
