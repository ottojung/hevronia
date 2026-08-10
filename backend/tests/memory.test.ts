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
import { extractText } from "../src/text.js";
import {
  deserializeTelegramEvent,
  type ObservedTelegramMessage,
  type TelegramSenderIdentity,
} from "../src/telegram-event.js";
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

const contentLengthTokens = (messages: { content: unknown }[]): number =>
  messages.reduce((total, m) => total + String(m.content).length, 0);

const budgetCounter = (messages: { content: unknown }[]): number => {
  const text = messages.map((m) => String(m.content)).join("\n");
  return ["one", "two", "three", "four", "five"].reduce(
    (total, word) => total + (text.includes(word) ? 10 : 0), 0,
  );
};

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
      "character 11 Іра любить чай; character 22 Іра не любить чай",
    ));
  }
  const layer = createConversationLayer({ dbPath: db, model: fakeModel(), summaryModel: summary,
    decisionMaker: planner, triggerTokens: 20, keepTokens: 12,
    trimTokensToSummarize: 1000, tokenCounter: contentLengthTokens });
  try {
    for (let index = 0; index < 10; index += 1) {
      const senderId = index % 2 === 0 ? 11 : 22;
      const turn = await layer.respond({ threadId,
        message: event(`повідомлення ${index}`, index + 1, senderId), hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
      assert.equal(turn.outcome.action, "silence");
    }
    const stored = await layer.getMessages(threadId);
    const summaryMessage = stored.find((message) =>
      message.additional_kwargs["lc_source"] === "summarization");
    assert.ok(summaryMessage);
    assert.ok(String(summaryMessage.content).startsWith(SUMMARY_PREFIX));
    assert.match(String(summaryMessage.content), /character 11 Іра любить чай/);
    assert.match(String(summaryMessage.content), /character 22 Іра не любить чай/);
    assert.doesNotMatch(String(summaryMessage.content), /telegram-user:/);
    assert.doesNotMatch(String(summaryMessage.content), /spreadsheet/);
    assert.doesNotMatch(String(summaryMessage.content), /user 11/);
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
    await first.respond({ threadId, message: event("перше", 1), hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
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

test("forum topics in one group have isolated histories and visible messages", async () => {
  const { dir, db } = tempPath();
  const seen = new Map<string, string[]>();
  const planner: SocialDecisionMaker = { decide: async (context) => {
    const topic = String(context.currentMessage.messageThreadId);
    seen.set(topic, context.visibleMessages.map(({ text }) => text));
    return { action: "silence" };
  } };
  const layer = createConversationLayer({ dbPath: db, model: fakeModel(),
    summaryModel: fakeModel(), decisionMaker: planner });
  const topicA = conversationThreadIdFromTelegramGroupChat(-100, 11);
  const topicB = conversationThreadIdFromTelegramGroupChat(-100, 22);
  try {
    await layer.respond({ threadId: topicA, message: event("тільки A", 1, 1, "Іра", 11),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await layer.respond({ threadId: topicB, message: event("тільки B", 2, 2, "Макс", 22),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.deepEqual(seen.get("11"), ["тільки A"]);
    assert.deepEqual(seen.get("22"), ["тільки B"]);
    assert.equal((await layer.getMessages(topicA)).length, 1);
    assert.equal((await layer.getMessages(topicB)).length, 1);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compaction preserves user and chat sender kinds with duplicate names", async () => {
  const { dir, db } = tempPath();
  const summary = fakeModel();
  for (let index = 0; index < 10; index += 1) {
    summary.respond(new AIMessage(
      "character 11 Новини любить чай; channel 22 Новини не любить чай",
    ));
  }
  const layer = createConversationLayer({ dbPath: db, model: fakeModel(), summaryModel: summary,
    decisionMaker: { decide: async () => ({ action: "silence" }) },
    triggerTokens: 20, keepTokens: 10, trimTokensToSummarize: 1000,
    tokenCounter: contentLengthTokens });
  try {
    for (let index = 0; index < 6; index += 1) {
      const sender: TelegramSenderIdentity = index % 2 === 0
        ? { kind: "user", id: 11 } : { kind: "chat", id: -22 };
      const observed: ObservedTelegramMessage = { ...event(`факт ${index}`, index + 1, 11, "Новини"),
        sender };
      await layer.respond({ threadId, message: observed,
        hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    }
    const compacted = (await layer.getMessages(threadId)).find((message) =>
      message.additional_kwargs["lc_source"] === "summarization");
    assert.ok(compacted);
    assert.match(String(compacted.content), /character 11 Новини любить чай/);
    assert.match(String(compacted.content), /channel 22 Новини не любить чай/);
    assert.doesNotMatch(String(compacted.content), /telegram-user:/);
    assert.doesNotMatch(String(compacted.content), /telegram-chat:/);
    assert.doesNotMatch(String(compacted.content), /user 11/);
    assert.doesNotMatch(String(compacted.content), /channel -22/);
    assert.doesNotMatch(String(compacted.content), /spreadsheet/);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the summary model receives rendered dream input with no internal message ids", async () => {
  const { dir, db } = tempPath();
  const captured: string[] = [];
  const summary = fakeModel();
  for (let index = 0; index < 10; index += 1) {
    summary.respond((messages) => {
      captured.push(messages.map(({ content }) => String(content)).join("\n"));
      return new AIMessage("character 11 said something about tea");
    });
  }
  const layer = createConversationLayer({ dbPath: db, model: fakeModel(), summaryModel: summary,
    decisionMaker: { decide: async () => ({ action: "silence" }) },
    triggerTokens: 20, keepTokens: 10, trimTokensToSummarize: 1000,
    tokenCounter: contentLengthTokens });
  try {
    for (let index = 0; index < 4; index += 1) {
      await layer.respond({ threadId,
        message: event(`повідомлення ${index}`, 912_345 + index, 11),
        hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    }
    const input = captured.join("\n");
    assert.match(input, /character 11/);
    assert.match(input, /notebook/);
    assert.match(input, /повідомлення 0/);
    assert.doesNotMatch(input, /912345/);
    assert.doesNotMatch(input, /"messageId"/);
    assert.doesNotMatch(input, /telegram-user:/);
    assert.doesNotMatch(input, /spreadsheet/);
    assert.doesNotMatch(input, /user 11/);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a throwing summary model aborts compaction without destroying history", async () => {
  const { dir, db } = tempPath();
  const summary = fakeModel().alwaysThrow(new Error("summary offline"));
  const layer = createConversationLayer({ dbPath: db, model: fakeModel(), summaryModel: summary,
    decisionMaker: { decide: async () => ({ action: "silence" }) },
    triggerTokens: 20, keepTokens: 10, trimTokensToSummarize: 1000,
    tokenCounter: contentLengthTokens });
  try {
    for (let index = 0; index < 6; index += 1) {
      await layer.respond({ threadId,
        message: event(`факт ${index}`, index + 1, 11),
        hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    }
    const stored = await layer.getMessages(threadId);
    assert.equal(stored.length, 6);
    assert.ok(!stored.some((m) => m.additional_kwargs["lc_source"] === "summarization"));
    assert.ok(!String(stored.map((m) => String(m.content)).join()).includes("Error generating summary"));
    for (const message of stored) {
      const parsed = deserializeTelegramEvent(extractText(String(message.content)));
      assert.equal(parsed.kind, "participant");
    }
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty summary response aborts compaction without destroying history", async () => {
  const { dir, db } = tempPath();
  const summary = fakeModel();
  for (let index = 0; index < 10; index += 1) {
    summary.respond(new AIMessage("   "));
  }
  const layer = createConversationLayer({ dbPath: db, model: fakeModel(), summaryModel: summary,
    decisionMaker: { decide: async () => ({ action: "silence" }) },
    triggerTokens: 20, keepTokens: 10, trimTokensToSummarize: 1000,
    tokenCounter: contentLengthTokens });
  try {
    for (let index = 0; index < 6; index += 1) {
      await layer.respond({ threadId,
        message: event(`факт ${index}`, index + 1, 11),
        hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    }
    const stored = await layer.getMessages(threadId);
    assert.equal(stored.length, 6);
    assert.ok(!stored.some((m) => m.additional_kwargs["lc_source"] === "summarization"));
    assert.ok(!String(stored.map((m) => String(m.content)).join()).includes("Error generating summary"));
    for (const message of stored) {
      const parsed = deserializeTelegramEvent(extractText(String(message.content)));
      assert.equal(parsed.kind, "participant");
    }
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compaction measures dream-rendered slices and never canonical JSON", async () => {
  const { dir, db } = tempPath();
  const summary = fakeModel();
  for (let index = 0; index < 10; index += 1) {
    summary.respond(new AIMessage("character 11 said something about tea"));
  }
  const dreamOnlyCounter = (messages: { content: unknown }[]): number => {
    const text = messages.map((m) => String(m.content)).join("\n");
    assert.ok(!text.includes('"messageId"'), "token counter received canonical JSON");
    assert.ok(!text.includes('"senderDisplayName"'), "token counter received canonical JSON");
    assert.ok(!text.includes('"kind":"participant"'), "token counter received canonical JSON");
    assert.ok(!text.includes('"replyTo"'), "token counter received canonical JSON");
    return text.length;
  };
  const layer = createConversationLayer({ dbPath: db, model: fakeModel(), summaryModel: summary,
    decisionMaker: { decide: async () => ({ action: "silence" }) },
    triggerTokens: 20, keepTokens: 10, trimTokensToSummarize: 1000,
    tokenCounter: dreamOnlyCounter });
  try {
    for (let index = 0; index < 5; index += 1) {
      await layer.respond({ threadId,
        message: event(`факт ${index}`, index + 1, 11),
        hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    }
    const stored = await layer.getMessages(threadId);
    const summaryMessage = stored.find((m) => m.additional_kwargs["lc_source"] === "summarization");
    assert.ok(summaryMessage);
    assert.match(String(summaryMessage.content), /character 11 said something about tea/);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("visible dollar sequences reach the summary model exactly", async () => {
  const { dir, db } = tempPath();
  const dollarText = "$& $' $` $$";
  const captured: string[] = [];
  const summary = fakeModel();
  for (let index = 0; index < 10; index += 1) {
    summary.respond((messages) => {
      captured.push(messages.map(({ content }) => String(content)).join("\n"));
      return new AIMessage("character 11 said something with dollar signs");
    });
  }
  const layer = createConversationLayer({ dbPath: db, model: fakeModel(), summaryModel: summary,
    decisionMaker: { decide: async () => ({ action: "silence" }) },
    triggerTokens: 20, keepTokens: 10, trimTokensToSummarize: 1000,
    tokenCounter: contentLengthTokens });
  try {
    await layer.respond({ threadId, message: event(dollarText, 912_401, 11),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await layer.respond({ threadId, message: event("друге повідомлення", 912_402, 11),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    const input = captured.join("\n");
    assert.ok(input.includes("$& $' $` $$"), "visible dollar text must be preserved exactly");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compaction removes only messages represented in the summary input", async () => {
  const { dir, db } = tempPath();
  const captured: string[] = [];
  const summary = fakeModel();
  for (let index = 0; index < 5; index += 1) {
    summary.respond((messages) => {
      captured.push(messages.map(({ content }) => String(content)).join("\n"));
      return new AIMessage("compacted one and two");
    });
  }
  const layer = createConversationLayer({ dbPath: db, model: fakeModel(), summaryModel: summary,
    decisionMaker: { decide: async () => ({ action: "silence" }) },
    triggerTokens: 50, keepTokens: 20, trimTokensToSummarize: 20,
    tokenCounter: budgetCounter });
  try {
    for (const [index, text] of ["one", "two", "three", "four", "five"].entries()) {
      await layer.respond({ threadId, message: event(text, index + 1, 11),
        hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    }
    const input = captured.join("\n");
    assert.ok(input.includes("one"), "summary input must represent message one");
    assert.ok(input.includes("two"), "summary input must represent message two");
    assert.ok(!input.includes("three"), "summary input must not include message three");
    const stored = await layer.getMessages(threadId);
    const summaryMessage = stored.find((m) => m.additional_kwargs["lc_source"] === "summarization");
    assert.ok(summaryMessage);
    assert.match(String(summaryMessage.content), /compacted one and two/);
    const sources = stored.filter((m) => m.additional_kwargs["lc_source"] !== "summarization");
    assert.deepEqual(
      sources.map((m) => deserializeTelegramEvent(extractText(String(m.content))).text),
      ["three", "four", "five"],
    );
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an oversized oldest message aborts compaction without dropping history", async () => {
  const { dir, db } = tempPath();
  const summary = fakeModel();
  const layer = createConversationLayer({ dbPath: db, model: fakeModel(), summaryModel: summary,
    decisionMaker: { decide: async () => ({ action: "silence" }) },
    triggerTokens: 30, keepTokens: 10, trimTokensToSummarize: 5,
    tokenCounter: budgetCounter });
  try {
    for (const [index, text] of ["one", "two", "three"].entries()) {
      await layer.respond({ threadId, message: event(text, index + 1, 11),
        hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    }
    const stored = await layer.getMessages(threadId);
    assert.equal(summary.callCount, 0);
    assert.ok(!stored.some((m) => m.additional_kwargs["lc_source"] === "summarization"));
    assert.deepEqual(
      stored.map((m) => deserializeTelegramEvent(extractText(String(m.content))).text),
      ["one", "two", "three"],
    );
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
