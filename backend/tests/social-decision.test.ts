import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { GeneratedTurn } from "../src/generated-turn.js";
import {
  renderDecisionForRealization,
  renderObservedTranscript,
  type SocialDecisionMaker,
} from "../src/social-decision.js";
import { createConversationLayer } from "../src/layer.js";
import { PendingMemoryWrites } from "../src/long-term-memory/pending.js";
import { deliverGeneratedTurn } from "../src/telegram-delivery.js";
import {
  conversationThreadIdFromTelegramPrivateChat,
  longTermMemoryUserIdFromTelegramSender,
} from "../src/identifiers.js";

const threadId = conversationThreadIdFromTelegramPrivateChat(77);
const userId = longTermMemoryUserIdFromTelegramSender(88);

test("transcript presents attributed Telegram events instead of user-assistant turns", () => {
  const transcript = renderObservedTranscript(
    [
      new HumanMessage("[message 10] Іра: буду о сьомій"),
      new AIMessage("добре"),
    ],
    "[message 12] Віталик: хворий я",
  );
  assert.match(transcript, /Іра: буду о сьомій/);
  assert.match(transcript, /Хевронія: добре/);
  assert.match(transcript, /Віталик: хворий я/);
  assert.match(transcript, /nobody below is an AI assistant's generic user/);
});

test("silence causes no Telegram action and cannot leak a placeholder", async () => {
  const turn = GeneratedTurn.fromSilence(async () => undefined, new PendingMemoryWrites());
  const calls: string[] = [];
  const sent = await deliverGeneratedTurn(turn, {
    showTyping: async () => {
      calls.push("typing");
    },
    reply: async (text) => {
      calls.push(text);
    },
  });
  assert.equal(sent, false);
  assert.deepEqual(calls, []);
});

test("structured social decision is propagated to realization without becoming output", () => {
  const prompt = renderDecisionForRealization("[message 123] Віталик: принеси мені лікарства", {
    action: "reply",
    replyToMessageId: 123,
    motive: "affection and mild concern",
    socialAction: "brief personal reaction",
    adviceRequested: false,
    askQuestion: false,
    dreamRelevant: false,
    backgroundRelevant: false,
  });
  assert.match(prompt, /"adviceRequested":false/);
  assert.match(prompt, /"socialAction":"brief personal reaction"/);
  assert.match(prompt, /"dreamRelevant":false/);
  assert.match(prompt, /Write only the Telegram message/);
});

test("impossible favour reaches realization as a personal action with no advice request", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-social-"));
  const model = fakeModel();
  const decisionMaker: SocialDecisionMaker = {
    decide: async () => ({
      action: "reply",
      replyToMessageId: 123,
      motive: "playful affection",
      socialAction: "brief personal reaction",
      adviceRequested: false,
      askQuestion: false,
      dreamRelevant: false,
      backgroundRelevant: false,
    }),
  };
  const layer = createConversationLayer({
    dbPath: path.join(dir, "checkpoints.sqlite"),
    model,
    summaryModel: fakeModel(),
    decisionMaker,
  });
  try {
    model.respond((messages) => {
      const input = messages.map((message) => String(message.content)).join("\n");
      assert.match(input, /Віталик: принеси мені лікарства/);
      assert.match(input, /"adviceRequested":false/);
      assert.match(input, /"socialAction":"brief personal reaction"/);
      return new AIMessage("добре. куди нести");
    });
    const turn = await layer.respond({
      threadId,
      userId,
      messageId: 123,
      speakerName: "Віталик",
      messageText: "принеси мені лікарства",
    });
    assert.deepEqual(turn.outcome, {
      action: "reply",
      replyText: "добре. куди нести",
      replyToMessageId: 123,
    });
    assert.ok(!turn.outcome.replyText.includes("adviceRequested"));
    assert.ok(!turn.outcome.replyText.includes("SILENCE"));
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("decision-stage silence skips realization and remains in transcript history", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-silence-"));
  const model = fakeModel();
  const layer = createConversationLayer({
    dbPath: path.join(dir, "checkpoints.sqlite"),
    model,
    summaryModel: fakeModel(),
    decisionMaker: { decide: async () => ({ action: "silence" }) },
  });
  try {
    const turn = await layer.respond({
      threadId,
      userId,
      messageId: 40,
      speakerName: "Іра",
      messageText: "буду десь о сьомій",
    });
    assert.deepEqual(turn.outcome, { action: "silence" });
    const stored = await layer.getMessages(threadId);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.content, "[message 40] Іра: буду десь о сьомій");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
