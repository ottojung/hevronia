import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { createConversationLayer } from "../src/layer.js";
import type { SocialDecisionContext, SocialDecisionMaker } from "../src/social-decision.js";
import { SUMMARY_PREFIX } from "../src/summary.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";
import {
  conversationThreadIdFromTelegramGroupChat,
  conversationThreadIdFromTelegramPrivateChat,
} from "../src/identifiers.js";

const threadId = conversationThreadIdFromTelegramPrivateChat(1);

function event(text: string, messageId: number, senderId = 1, name = "Іра",
  messageThreadId: number | null = null): ObservedTelegramMessage {
  return { kind: "participant", messageId, sender: { kind: "user", id: senderId }, senderDisplayName: name,
    chatKind: "group", text, messageThreadId, replyTo: null, directlyAddressed: false };
}

function tempPath(): { dir: string; db: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-memory-"));
  return { dir, db: path.join(dir, "checkpoint.sqlite") };
}

test("many consecutive silent observations compact bounded multi-participant state", async () => {
  const { dir, db } = tempPath();
  const contexts: SocialDecisionContext[] = [];
  const planner: SocialDecisionMaker = { decide: async (context) => {
    contexts.push(context);
    return { action: "silence" };
  } };
  const summary = fakeModel();
  for (let index = 0; index < 20; index += 1) {
    summary.respond(new AIMessage(
      "telegram-user:11 Іра любить чай; telegram-user:22 Іра не любить чай",
    ));
  }
  const layer = createConversationLayer({ dbPath: db, model: fakeModel(), summaryModel: summary,
    decisionMaker: planner, triggerTokens: 20, keepTokens: 12,
    trimTokensToSummarize: 100, tokenCounter: (messages) => messages.length * 10 });
  try {
    for (let index = 0; index < 10; index += 1) {
      const senderId = index % 2 === 0 ? 11 : 22;
      const turn = await layer.respond({ threadId,
        message: event(`повідомлення ${index}`, index + 1, senderId), hevroniaSender: { kind: "user", id: 999 } });
      assert.equal(turn.outcome.action, "silence");
    }
    const stored = await layer.getMessages(threadId);
    const summaryMessage = stored.find((message) =>
      message.additional_kwargs["lc_source"] === "summarization");
    assert.ok(summaryMessage);
    assert.ok(String(summaryMessage.content).startsWith(SUMMARY_PREFIX));
    assert.match(String(summaryMessage.content), /telegram-user:11 Іра любить чай/);
    assert.match(String(summaryMessage.content), /telegram-user:22 Іра не любить чай/);
    assert.ok(stored.length < 10);
    assert.ok(contexts.every(({ boundedHistory }) => boundedHistory.length < 10));
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical observed state survives layer recreation", async () => {
  const { dir, db } = tempPath();
  const silence: SocialDecisionMaker = { decide: async () => ({ action: "silence" }) };
  try {
    const first = createConversationLayer({ dbPath: db, model: fakeModel(),
      summaryModel: fakeModel(), decisionMaker: silence });
    await first.respond({ threadId, message: event("перше", 1), hevroniaSender: { kind: "user", id: 999 } });
    await first.close();
    const second = createConversationLayer({ dbPath: db, model: fakeModel(),
      summaryModel: fakeModel(), decisionMaker: silence });
    const stored = await second.getMessages(threadId);
    assert.equal(stored.length, 1);
    assert.match(String(stored[0]?.content), /"sender":\{"kind":"user","id":1\}/);
    assert.match(String(stored[0]?.content), /"text":"перше"/);
    await second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("forum topics in one group have isolated histories and reply candidates", async () => {
  const { dir, db } = tempPath();
  const seen = new Map<string, string[]>();
  const planner: SocialDecisionMaker = { decide: async (context) => {
    const topic = String(context.currentMessage.messageThreadId);
    seen.set(topic, context.replyCandidates.map(({ text }) => text));
    return { action: "silence" };
  } };
  const layer = createConversationLayer({ dbPath: db, model: fakeModel(),
    summaryModel: fakeModel(), decisionMaker: planner });
  const topicA = conversationThreadIdFromTelegramGroupChat(-100, 11);
  const topicB = conversationThreadIdFromTelegramGroupChat(-100, 22);
  try {
    await layer.respond({ threadId: topicA, message: event("тільки A", 1, 1, "Іра", 11),
      hevroniaSender: { kind: "user", id: 999 } });
    await layer.respond({ threadId: topicB, message: event("тільки B", 2, 2, "Макс", 22),
      hevroniaSender: { kind: "user", id: 999 } });
    assert.deepEqual(seen.get("11"), ["тільки A"]);
    assert.deepEqual(seen.get("22"), ["тільки B"]);
    assert.equal((await layer.getMessages(topicA)).length, 1);
    assert.equal((await layer.getMessages(topicB)).length, 1);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
