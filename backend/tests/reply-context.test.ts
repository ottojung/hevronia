import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { createConversationLayer } from "../src/layer.js";
import type { SocialDecision, SocialDecisionMaker } from "../src/social-decision.js";
import { renderDreamEvent } from "../src/dream-render.js";
import type { DeliveredHevroniaMessage, ObservedTelegramMessage } from "../src/telegram-event.js";
import { conversationThreadIdFromTelegramPrivateChat } from "../src/identifiers.js";
import { silenceDecision } from "./memory-fixtures.js";

const threadId = conversationThreadIdFromTelegramPrivateChat(71);

function participant(messageId: number, senderId: number, name: string, text: string): ObservedTelegramMessage {
  return { kind: "participant", messageId, sender: { kind: "user", id: senderId }, senderDisplayName: name,
    chatKind: "group", text, messageThreadId: null, replyTo: null, directlyAddressed: false };
}

function speak(
  overrides: Partial<Omit<Exclude<SocialDecision, { action: "silence" }>, "action">> = {},
): Exclude<SocialDecision, { action: "silence" }> {
  return {
    action: "speak",
    addressCharacter: "P1",
    replyToMessage: null,
    interpretation: "You understand this as a real change in her life.",
    feltState: "This leaves you genuinely attentive.",
    activeDesire: "You want to know what actually happened.",
    desiredOutcome: "You want the true story to become clear to you.",
    opportunity: "You notice she is still here and willing to talk.",
    pursuit: "You decide to ask her directly what happened.",
    ...overrides,
  };
}

test("realization receives the dream character framing and the verbatim subjective paragraph", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-target-context-"));
  let planningCall = 0;
  const planner: SocialDecisionMaker = { decide: async () => ++planningCall === 1
    ? silenceDecision()
    : speak() };
  const model = fakeModel();
  model.respond((messages) => {
    const input = messages.map(({ content }) => String(content)).join("\n");
    assert.match(input, /Character 101, currently displayed by Telegram as “Іра”/);
    assert.match(input, /Character 202, currently displayed by Telegram as “Макс”/);
    assert.match(input, /Your sleeping mind made character 101 say:\n\nя звільняюся/);
    assert.ok(input.includes("You understand this as a real change in her life. " +
      "This leaves you genuinely attentive. You want to know what actually happened. " +
      "You want the true story to become clear to you. " +
      "You notice she is still here and willing to talk. " +
      "You decide to ask her directly what happened."));
    assert.match(input, /Make the Telegram message you choose to speak appear\. Return only its visible text\./);
    assert.doesNotMatch(input, /message 10/);
    assert.doesNotMatch(input, /message 11/);
    assert.doesNotMatch(input, /P1/);
    assert.doesNotMatch(input, /M1/);
    assert.doesNotMatch(input, /addressCharacter/);
    assert.doesNotMatch(input, /replyToMessage/);
    assert.doesNotMatch(input, /telegram-user:/);
    assert.doesNotMatch(input, /spreadsheet/);
    return new AIMessage("стій. а шо сталося?");
  });
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"), model,
    summaryModel: fakeModel(), decisionMaker: planner });
  try {
    await layer.respond({ threadId, message: participant(10, 101, "Іра", "я звільняюся"),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    const turn = await layer.respond({ threadId,
      message: participant(11, 202, "Макс", "хто буде каву"), hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "speak");
    if (turn.outcome.action === "speak") assert.equal(turn.outcome.replyTo, null);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("incoming and outgoing events share one reply relationship and render its target", () => {
  const incoming: ObservedTelegramMessage = { ...participant(6, 101, "Іра", "та ні"),
    replyTo: { targetMessageId: 5, targetSender: { kind: "user", id: 999 },
      targetSenderDisplayName: "Хевронія", targetText: "ти точно прийдеш?",
      targetIsHevronia: true }, directlyAddressed: true };
  const outgoing: DeliveredHevroniaMessage = { kind: "hevronia", messageId: 7, sender: { kind: "user", id: 999 },
    senderDisplayName: "Хевронія", chatKind: "group", messageThreadId: null,
    text: "ну ясно", replyTo: { targetMessageId: 6, targetSender: { kind: "user", id: 101 },
      targetSenderDisplayName: "Іра", targetText: "та ні", targetIsHevronia: false } };
  if (outgoing.replyTo === null) assert.fail("expected outgoing reply relationship");
  assert.deepEqual(Object.keys(incoming.replyTo ?? {}), Object.keys(outgoing.replyTo));
  const incomingRendered = renderDreamEvent(incoming);
  assert.match(incomingRendered, /Your sleeping mind made character 101 reply to one of your earlier messages with:/);
  assert.match(incomingRendered, /та ні/);
  assert.doesNotMatch(incomingRendered, /message 5/);
  assert.doesNotMatch(incomingRendered, /message 6/);
  assert.doesNotMatch(incomingRendered, /telegram-user:/);
  const outgoingRendered = renderDreamEvent(outgoing);
  assert.match(outgoingRendered, /You previously chose to reply to character 101 with:/);
  assert.match(outgoingRendered, /ну ясно/);
  assert.doesNotMatch(outgoingRendered, /message 6/);
  assert.doesNotMatch(outgoingRendered, /"targetMessageId"/);
});
