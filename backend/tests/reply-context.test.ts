import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { createConversationLayer } from "../src/layer.js";
import type { SocialDecisionMaker } from "../src/social-decision.js";
import { renderDreamEvent } from "../src/dream-render.js";
import type { DeliveredHevroniaMessage, ObservedTelegramMessage, ReplyRelationship } from "../src/telegram-event.js";
import { conversationThreadIdFromTelegramPrivateChat } from "../src/identifiers.js";

const threadId = conversationThreadIdFromTelegramPrivateChat(71);

function participant(messageId: number, senderId: number, name: string, text: string): ObservedTelegramMessage {
  return { kind: "participant", messageId, sender: { kind: "user", id: senderId }, senderDisplayName: name,
    chatKind: "group", text, messageThreadId: null, replyTo: null, directlyAddressed: false };
}

test("realization receives the fully resolved older target", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-target-context-"));
  let planningCall = 0;
  const planner: SocialDecisionMaker = { decide: async () => ++planningCall === 1
    ? { action: "silence" }
    : { action: "reply", targetChoice: "A", interpretation: "concern",
      activeDesire: "want to understand", desiredOutcome: "hear the reason" } };
  const model = fakeModel();
  model.respond((messages) => {
    const input = messages.map(({ content }) => String(content)).join("\n");
    assert.match(input, /You have decided to make a Telegram reply appear to the character your notebook calls “character 101”/);
    assert.match(input, /The visible message you are responding to was:/);
    assert.match(input, /я звільняюся/);
    assert.match(input, /notebook/);
    assert.doesNotMatch(input, /message 10/);
    assert.doesNotMatch(input, /message 11/);
    assert.doesNotMatch(input, /targetChoice/);
    assert.doesNotMatch(input, /reply choice/i);
    assert.doesNotMatch(input, /telegram-user:/);
    assert.doesNotMatch(input, /spreadsheet/);
    assert.doesNotMatch(input, /"targetMessageId"/);
    return new AIMessage("стій. а шо сталося?");
  });
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"), model,
    summaryModel: fakeModel(), decisionMaker: planner });
  try {
    await layer.respond({ threadId, message: participant(10, 101, "Іра", "я звільняюся"),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    const turn = await layer.respond({ threadId,
      message: participant(11, 202, "Макс", "хто буде каву"), hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "reply");
    if (turn.outcome.action === "reply") assert.equal(turn.outcome.replyTo.targetMessageId, 10);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("incoming and outgoing events share one reply relationship and render its target", () => {
  const relationship: ReplyRelationship = { targetMessageId: 5,
    targetSender: { kind: "user", id: 999 },
    targetSenderDisplayName: "Хевронія", targetText: "ти точно прийдеш?" };
  const incoming: ObservedTelegramMessage = { ...participant(6, 101, "Іра", "та ні"),
    replyTo: relationship, directlyAddressed: true };
  const outgoing: DeliveredHevroniaMessage = { kind: "hevronia", messageId: 7, sender: { kind: "user", id: 999 },
    senderDisplayName: "Хевронія", chatKind: "group", messageThreadId: null,
    text: "ну ясно", replyTo: { targetMessageId: 6, targetSender: { kind: "user", id: 101 },
      targetSenderDisplayName: "Іра", targetText: "та ні" } };
  if (outgoing.replyTo === null) assert.fail("expected outgoing reply relationship");
  assert.deepEqual(Object.keys(incoming.replyTo ?? {}), Object.keys(outgoing.replyTo));
  const incomingRendered = renderDreamEvent(incoming);
  assert.match(incomingRendered, /reply to one of your own earlier messages/);
  assert.match(incomingRendered, /ти точно прийдеш\?/);
  assert.match(incomingRendered, /та ні/);
  assert.match(incomingRendered, /character 101/);
  assert.doesNotMatch(incomingRendered, /message 5/);
  assert.doesNotMatch(incomingRendered, /message 6/);
  assert.doesNotMatch(incomingRendered, /telegram-user:/);
  const outgoingRendered = renderDreamEvent(outgoing);
  assert.match(outgoingRendered, /you chose to make this Telegram message appear/);
  assert.match(outgoingRendered, /reply to an earlier message from the character Telegram displayed as “Іра”/);
  assert.match(outgoingRendered, /Your reply was:/);
  assert.match(outgoingRendered, /ну ясно/);
  assert.doesNotMatch(outgoingRendered, /message 6/);
  assert.doesNotMatch(outgoingRendered, /"targetMessageId"/);
});
