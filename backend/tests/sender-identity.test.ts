import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { fakeModel } from "@langchain/core/testing";

import { createConversationLayer } from "../src/layer.js";
import type { LongTermMemory } from "../src/long-term-memory/index.js";
import { createObservedTelegramMessage, telegramSenderIdentity } from "../src/telegram-observation.js";
import { renderTelegramEvent } from "../src/telegram-event.js";
import { conversationThreadIdFromTelegramGroupChat } from "../src/identifiers.js";

test("user and send-as-chat identities remain distinct and chat senders skip Mem0", async () => {
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
  assert.match(renderTelegramEvent(user), /telegram-user:101/);
  assert.match(renderTelegramEvent(sendAsChat), /telegram-chat:-500/);
  const calls: string[] = [];
  const memory: LongTermMemory = {
    search: async (id) => { calls.push(`search:${id.toPersistenceKey()}`); return []; },
    rememberUserMessage: async (id) => { calls.push(`write:${id.toPersistenceKey()}`); },
    deleteAll: async () => undefined,
  };
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-sender-"));
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(), longTermMemory: memory,
    decisionMaker: { decide: async () => ({ action: "silence" }) } });
  try {
    const threadId = conversationThreadIdFromTelegramGroupChat(-10);
    await layer.respond({ threadId, message: user,
      hevroniaSender: { kind: "user", id: 999 } });
    await layer.respond({ threadId, message: sendAsChat,
      hevroniaSender: { kind: "user", id: 999 } });
    await layer.close();
    assert.deepEqual(calls, ["search:telegram-user:101", "write:telegram-user:101",
      "search:telegram-user:101"]);
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
  assert.match(renderTelegramEvent(reply), /telegram-chat:-500/);
});
