import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { createConversationLayer } from "../src/layer.js";
import type { SocialDecisionMaker } from "../src/social-decision.js";
import { renderTelegramEvent, type DeliveredHevroniaMessage, type ObservedTelegramMessage } from "../src/telegram-event.js";
import { conversationThreadIdFromTelegramPrivateChat } from "../src/identifiers.js";

const threadId = conversationThreadIdFromTelegramPrivateChat(71);

function participant(messageId: number, senderId: number, name: string, text: string): ObservedTelegramMessage {
  return { kind: "participant", messageId, senderId, senderDisplayName: name,
    chatKind: "group", text, replyTo: null, directlyAddressed: false };
}

test("realization receives the fully resolved older target", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-target-context-"));
  let planningCall = 0;
  const planner: SocialDecisionMaker = { decide: async () => ++planningCall === 1
    ? { action: "silence" }
    : { action: "reply", targetCandidateKey: "candidate-0", motive: "concern",
      socialAction: "personal reaction", adviceRequested: false, askQuestion: true,
      dreamRelevant: false, backgroundRelevant: false } };
  const model = fakeModel();
  model.respond((messages) => {
    const input = messages.map(({ content }) => String(content)).join("\n");
    assert.match(input, /"messageId":10/);
    assert.match(input, /"senderId":101/);
    assert.match(input, /"senderDisplayName":"Іра"/);
    assert.match(input, /"text":"я звільняюся"/);
    assert.doesNotMatch(input, /"targetCandidateKey"/);
    return new AIMessage("стій. а шо сталося?");
  });
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"), model,
    summaryModel: fakeModel(), decisionMaker: planner });
  try {
    await layer.respond({ threadId, message: participant(10, 101, "Іра", "я звільняюся"),
      hevroniaSenderId: 999 });
    const turn = await layer.respond({ threadId,
      message: participant(11, 202, "Макс", "хто буде каву"), hevroniaSenderId: 999 });
    assert.equal(turn.outcome.action, "reply");
    if (turn.outcome.action === "reply") assert.equal(turn.outcome.replyTo.targetMessageId, 10);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("incoming and outgoing events share one reply relationship and render its target", () => {
  const relationship = { targetMessageId: 5, targetSenderId: 999,
    targetSenderDisplayName: "Хевронія", targetText: "ти точно прийдеш?" };
  const incoming: ObservedTelegramMessage = { ...participant(6, 101, "Іра", "та ні"),
    replyTo: relationship, directlyAddressed: true };
  const outgoing: DeliveredHevroniaMessage = { kind: "hevronia", messageId: 7, senderId: 999,
    senderDisplayName: "Хевронія", chatKind: "group",
    text: "ну ясно", replyTo: { targetMessageId: 6, targetSenderId: 101,
      targetSenderDisplayName: "Іра", targetText: "та ні" } };
  if (outgoing.replyTo === null) assert.fail("expected outgoing reply relationship");
  assert.deepEqual(Object.keys(incoming.replyTo ?? {}), Object.keys(outgoing.replyTo));
  assert.match(renderTelegramEvent(incoming), /ти точно прийдеш\?/);
  assert.match(renderTelegramEvent(outgoing), /Іра.*та ні/);
});
