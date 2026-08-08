import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { createConversationLayer } from "../src/layer.js";
import type { LongTermMemory } from "../src/long-term-memory/index.js";
import { SYSTEM_PROMPT } from "../src/personality.js";
import { createSocialDecisionMaker, type SocialDecisionMaker } from "../src/social-decision.js";
import { createObservedTelegramMessage } from "../src/telegram-observation.js";
import { deliverGeneratedTurn } from "../src/telegram-delivery.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";
import {
  conversationThreadIdFromTelegramPrivateChat,
  longTermMemoryUserIdFromTelegramSender,
} from "../src/identifiers.js";

const threadId = conversationThreadIdFromTelegramPrivateChat(77);
const userId = longTermMemoryUserIdFromTelegramSender(88);

function message(overrides: Partial<ObservedTelegramMessage> = {}): ObservedTelegramMessage {
  return { kind: "participant", messageId: 10, senderId: 88,
    senderDisplayName: "Іра", chatKind: "group", text: "та ні", replyTo: null,
    directlyAddressed: false, ...overrides };
}

test("private, group-reply, and ambient direct interaction semantics remain distinct", () => {
  const privateMessage = createObservedTelegramMessage({ messageId: 1, senderId: 11,
    senderDisplayName: "Іра", chatKind: "private", text: "привіт",
    mentionsHevronia: false, replyTo: null });
  const groupReply = createObservedTelegramMessage({ messageId: 2, senderId: 11,
    senderDisplayName: "Іра", chatKind: "group", text: "та ні",
    mentionsHevronia: false, replyTo: { messageId: 1, senderId: 999,
      senderDisplayName: "Хевронія", isHevronia: true } });
  const ambient = createObservedTelegramMessage({ messageId: 3, senderId: 11,
    senderDisplayName: "Іра", chatKind: "group", text: "та ні",
    mentionsHevronia: false, replyTo: null });
  assert.equal(privateMessage.directlyAddressed, true);
  assert.equal(groupReply.directlyAddressed, true);
  assert.equal(groupReply.replyTo?.isHevronia, true);
  assert.equal(ambient.directlyAddressed, false);
});

test("real planner receives canonical personality, background, and recalled memory", async () => {
  const model = fakeModel();
  model.respond((messages) => {
    const input = messages.map((item) => typeof item.content === "string" ? item.content : JSON.stringify(item.content)).join("\n");
    assert.match(input, /You are Хевронія/);
    assert.match(input, /Warcraft is a hidden layer/);
    assert.match(input, /telegram-user:88/);
    assert.match(input, /боїться павуків/);
    return new AIMessage(JSON.stringify({ action: "silence" }));
  });
  const planner = createSocialDecisionMaker(model, SYSTEM_PROMPT);
  await planner.decide({ boundedHistory: [], currentMessage: message(),
    replyCandidates: [{ key: "candidate-0", messageId: 10, senderId: 88,
      senderDisplayName: "Іра" }], recalledMemories: [{ text: "Іра боїться павуків" }] });
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
    const turn = await layer.respond({ threadId, userId, message: message(),
      hevroniaSenderId: 999 });
    let delivered = false;
    const sent = await deliverGeneratedTurn(turn, { showTyping: async () => undefined,
      reply: async () => { delivered = true; return 100; } });
    assert.equal(sent, false);
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
    seen.push(context.replyCandidates.map(({ senderId }) => senderId));
    return { action: "silence" };
  } };
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(), decisionMaker: planner });
  try {
    await layer.respond({ threadId, userId, message: message({ senderId: 11 }),
      hevroniaSenderId: 999 });
    await layer.respond({ threadId, userId, message: message({ messageId: 11, senderId: 22 }),
      hevroniaSenderId: 999 });
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
    const turn = await layer.respond({ threadId, userId, message: message(),
      hevroniaSenderId: 999 });
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
    const silent = await layer.respond({ threadId, userId, message: message({ messageId: 1 }),
      hevroniaSenderId: 999 });
    await deliverGeneratedTurn(silent, { showTyping: async () => undefined,
      reply: async () => 100 });
    const reply = await layer.respond({ threadId, userId, message: message({ messageId: 2 }),
      hevroniaSenderId: 999 });
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

test("recalled memory reaches the planner before silence decision", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-recall-"));
  const memory: LongTermMemory = { search: async () => [{ text: "важлива обіцянка" }],
    rememberUserMessage: async () => undefined, deleteAll: async () => undefined };
  let recalled = "";
  const planner: SocialDecisionMaker = { decide: async (context) => {
    recalled = context.recalledMemories.map(({ text }) => text).join();
    return { action: "silence" };
  } };
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(), decisionMaker: planner,
    longTermMemory: memory });
  try {
    await layer.respond({ threadId, userId, message: message(), hevroniaSenderId: 999 });
    assert.equal(recalled, "важлива обіцянка");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
