import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { createConversationLayer } from "../src/layer.js";
import {
  longTermMemoryUserIdFromTelegramSender,
  conversationThreadIdFromTelegramPrivateChat,
} from "../src/identifiers.js";
import { SYSTEM_PROMPT } from "../src/personality.js";
import { createSocialDecisionMaker, type SocialDecisionMaker } from "../src/social-decision.js";
import { createObservedTelegramMessage, hasDirectMention } from "../src/telegram-observation.js";
import { deliverGeneratedTurn } from "../src/telegram-delivery.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";
import { staticMemory } from "./memory-fixtures.js";

const threadId = conversationThreadIdFromTelegramPrivateChat(77);

function message(overrides: Partial<ObservedTelegramMessage> = {}): ObservedTelegramMessage {
  return { kind: "participant", messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", chatKind: "group", messageThreadId: null, text: "та ні", replyTo: null,
    directlyAddressed: false, ...overrides };
}

test("private, group-reply, and ambient direct interaction semantics remain distinct", () => {
  const privateMessage = createObservedTelegramMessage({ messageId: 1, sender: { kind: "user", id: 11 },
    senderDisplayName: "Іра", chatKind: "private", messageThreadId: null, text: "привіт",
    mentionsHevronia: false, replyTo: null });
  const groupReply = createObservedTelegramMessage({ messageId: 2, sender: { kind: "user", id: 11 },
    senderDisplayName: "Іра", chatKind: "group", messageThreadId: null, text: "та ні",
    mentionsHevronia: false, replyTo: { targetMessageId: 1, targetSender: { kind: "user", id: 999 },
      targetSenderDisplayName: "Хевронія", targetText: "старе повідомлення", targetsHevronia: true } });
  const ambient = createObservedTelegramMessage({ messageId: 3, sender: { kind: "user", id: 11 },
    senderDisplayName: "Іра", chatKind: "group", messageThreadId: null, text: "та ні",
    mentionsHevronia: false, replyTo: null });
  assert.equal(privateMessage.directlyAddressed, true);
  assert.equal(groupReply.directlyAddressed, true);
  assert.equal(groupReply.replyTo?.targetSender.id, 999);
  assert.equal(ambient.directlyAddressed, false);
});

test("direct mention detection uses Telegram entities rather than raw substrings", () => {
  assert.equal(hasDirectMention("@hevronia_bot привіт", undefined, 999, "hevronia_bot"), false);
  assert.equal(hasDirectMention("@hevronia_bot привіт",
    [{ type: "mention", offset: 0, length: 13 }], 999, "hevronia_bot"), true);
  assert.equal(hasDirectMention("привіт", [{ type: "text_mention", offset: 0,
    length: 6, user: { id: 999 } }], 999, "hevronia_bot"), true);
});

test("real planner receives canonical personality, background, and recalled memory", async () => {
  const model = fakeModel();
  model.respond((messages) => {
    const input = messages.map((item) => typeof item.content === "string" ? item.content : JSON.stringify(item.content)).join("\n");
    assert.match(input, /You are Хевронія/);
    assert.match(input, /Warcraft is part of the dream/);
    assert.match(input, /telegram-user:88/);
    assert.match(input, /боїться павуків/);
    return new AIMessage(JSON.stringify({ decision: { action: "silence" } }));
  });
  const planner = createSocialDecisionMaker(model, SYSTEM_PROMPT);
  await planner.decide({ boundedHistory: [], currentMessage: message(),
    replyCandidates: [{ key: "candidate-0", messageId: 10, sender: { kind: "user", id: 88 },
      senderDisplayName: "Іра", text: "та ні" }], participantMemories: [{
        participant: { kind: "user", id: 88 }, memories: [{ text: "Іра боїться павуків" }],
      }] });
});

test("a non-candidate planner target cannot reach Telegram delivery", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-target-"));
  const planner: SocialDecisionMaker = { decide: async () => ({ action: "reply",
    targetCandidateKey: "invented", motive: "x", socialAction: "reaction",
    adviceRequested: false, askQuestion: false, dreamRelevant: false,
    backgroundRelevant: false }) };
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(), decisionMaker: planner });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    let delivered = false;
    const sent = await deliverGeneratedTurn(turn, { showTyping: async () => undefined,
      reply: async () => { delivered = true; return 100; } });
    assert.deepEqual(sent, { status: "silence" });
    assert.equal(delivered, false);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("duplicate display names retain distinct stable identities", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-names-"));
  const seen: number[][] = [];
  const planner: SocialDecisionMaker = { decide: async (context) => {
    seen.push(context.replyCandidates.map(({ sender }) => sender.id));
    return { action: "silence" };
  } };
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(), decisionMaker: planner });
  try {
    await layer.respond({ threadId, message: message({ sender: { kind: "user", id: 11 } }),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await layer.respond({ threadId, message: message({ messageId: 11, sender: { kind: "user", id: 22 } }),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.deepEqual(seen.at(-1), [11, 22]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reply metadata is ephemeral and undelivered text never enters history", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-delivery-"));
  const planner: SocialDecisionMaker = { decide: async () => ({ action: "reply",
    targetCandidateKey: "candidate-0", motive: "private motive",
    socialAction: "brief reaction", adviceRequested: false, askQuestion: false,
    dreamRelevant: false, backgroundRelevant: false }) };
  const model = fakeModel();
  model.respond(new AIMessage("недоставлена відповідь"));
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model, summaryModel: fakeModel(), decisionMaker: planner });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await assert.rejects(() => deliverGeneratedTurn(turn, {
      showTyping: async () => undefined,
      reply: async () => { throw new Error("Telegram failed"); },
    }));
    const history = JSON.stringify((await layer.getMessages(threadId)).map(({ content }) => content));
    assert.ok(!history.includes("недоставлена відповідь"));
    assert.ok(!history.includes("Private structured social decision"));
    assert.ok(!history.includes("private motive"));
    assert.ok(!history.includes("Realize that decision"));
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("silence and delivered reply persist the same canonical incoming representation", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-canonical-"));
  let call = 0;
  const planner: SocialDecisionMaker = { decide: async () => ++call === 1
    ? { action: "silence" }
    : { action: "reply", targetCandidateKey: "candidate-1", motive: "m",
      socialAction: "reaction", adviceRequested: false, askQuestion: false,
      dreamRelevant: false, backgroundRelevant: false } };
  const model = fakeModel();
  model.respond(new AIMessage("ага"));
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"), model,
    summaryModel: fakeModel(), decisionMaker: planner });
  try {
    const silent = await layer.respond({ threadId, message: message({ messageId: 1 }),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await deliverGeneratedTurn(silent, { showTyping: async () => undefined,
      reply: async () => 100 });
    const reply = await layer.respond({ threadId, message: message({ messageId: 2 }),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    const sentTexts: string[] = [];
    await deliverGeneratedTurn(reply, { showTyping: async () => undefined,
      reply: async (text) => { sentTexts.push(text); return 101; } });
    const contents = (await layer.getMessages(threadId)).map(({ content }) => String(content));
    assert.match(contents[0] ?? "", /"kind":"participant"/);
    assert.match(contents[1] ?? "", /"kind":"participant"/);
    assert.match(contents[2] ?? "", /"kind":"hevronia"/);
    assert.deepEqual(sentTexts, ["ага"]);
    assert.ok(!sentTexts.join().includes("motive"));
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a planner exception fails safely to silence instead of crashing", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-planner-crash-"));
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(),
    decisionMaker: { decide: async () => { throw new Error("planner boom"); } } });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    let delivered = false;
    const sent = await deliverGeneratedTurn(turn, { showTyping: async () => undefined,
      reply: async () => { delivered = true; return 100; } });
    assert.deepEqual(sent, { status: "silence" });
    assert.equal(delivered, false);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recalled memory reaches the planner before silence decision", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-recall-"));
  const memory = staticMemory(new Map([
    [longTermMemoryUserIdFromTelegramSender(88).toPersistenceKey(),
      [{ text: "важлива обіцянка" }]],
  ]));
  let recalled = "";
  const planner: SocialDecisionMaker = { decide: async (context) => {
    recalled = context.participantMemories.flatMap(({ memories }) =>
      memories.map(({ text }) => text)).join();
    return { action: "silence" };
  } };
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(), decisionMaker: planner,
    lazyMemory: memory });
  try {
    await layer.respond({ threadId, message: message(), hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(recalled, "важлива обіцянка");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
