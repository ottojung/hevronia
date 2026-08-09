import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { fakeModel } from "@langchain/core/testing";

import { createConversationLayer } from "../src/layer.js";
import type { LazyLongTermMemory } from "../src/long-term-memory/runtime.js";
import { createObservedTelegramMessage, telegramSenderIdentity } from "../src/telegram-observation.js";
import { renderDreamEvent } from "../src/dream-render.js";
import { conversationThreadIdFromTelegramGroupChat } from "../src/identifiers.js";

test("user and send-as-chat identities remain distinct and chat senders skip memory work", async () => {
  assert.deepEqual(telegramSenderIdentity(777), { kind: "user", id: 777 });
  assert.deepEqual(telegramSenderIdentity(777, -500), { kind: "chat", id: -500 });
  const user = createObservedTelegramMessage({ messageId: 1,
    sender: { kind: "user", id: 101 }, senderDisplayName: "Новини",
    chatKind: "group", text: "від людини", messageThreadId: null,
    mentionsHevronia: false, replyTo: null });
  const sendAsChat = createObservedTelegramMessage({ messageId: 2,
    sender: { kind: "chat", id: -500 }, senderDisplayName: "Новини",
    chatKind: "group", text: "від каналу", messageThreadId: null,
    mentionsHevronia: false, replyTo: null });
  assert.match(renderDreamEvent(user), /user 101/);
  assert.match(renderDreamEvent(user), /від людини/);
  assert.doesNotMatch(renderDreamEvent(user), /telegram-user:101/);
  assert.match(renderDreamEvent(sendAsChat), /channel -500/);
  assert.match(renderDreamEvent(sendAsChat), /від каналу/);
  assert.doesNotMatch(renderDreamEvent(sendAsChat), /telegram-chat:-500/);
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
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(), lazyMemory: memory,
    decisionMaker: { decide: async () => ({ action: "silence" }) } });
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
    sender: { kind: "user", id: 101 }, senderDisplayName: "Іра",
    chatKind: "group", text: "та ні", messageThreadId: null,
    mentionsHevronia: false, replyTo: { targetMessageId: 2,
      targetSender: { kind: "chat", id: -500 }, targetSenderDisplayName: "Новини",
      targetText: "від каналу", targetsHevronia: false } });
  assert.equal(reply.replyTo?.targetSender.kind, "chat");
  const rendered = renderDreamEvent(reply);
  assert.match(rendered, /reply to message 2/);
  assert.match(rendered, /character displayed as “Новини”/);
  assert.match(rendered, /від каналу/);
  assert.match(rendered, /user 101/);
  assert.doesNotMatch(rendered, /telegram-chat:/);
});
