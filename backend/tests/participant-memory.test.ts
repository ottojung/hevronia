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
import type { SocialDecisionMaker, ReplyCandidate } from "../src/social-decision.js";
import type { ObservedTelegramMessage, TelegramSenderIdentity } from "../src/telegram-event.js";
import { memoriesForCandidates, selectedParticipantIds } from "../src/participant-memory.js";
import { staticMemory } from "./memory-fixtures.js";

function message(id: number, sender: TelegramSenderIdentity, name: string, text: string): ObservedTelegramMessage {
  return { kind: "participant", messageId: id, sender, senderDisplayName: name,
    chatKind: "group", text, messageThreadId: null, replyTo: null,
    directlyAddressed: false };
}

const candidates: ReplyCandidate[] = [
  { key: "candidate-0", messageId: 1, sender: { kind: "user", id: 101 },
    senderDisplayName: "Іра", text: "я нарешті це зробила" },
  { key: "candidate-1", messageId: 2, sender: { kind: "user", id: 202 },
    senderDisplayName: "Макс", text: "хтось буде каву?" },
  { key: "candidate-2", messageId: 3, sender: { kind: "chat", id: -500 },
    senderDisplayName: "Канал", text: "оголошення" },
];

test("selected participant ids are user-scoped and bounded", () => {
  assert.deepEqual(selectedParticipantIds(candidates), [202, 101]);
  assert.deepEqual(selectedParticipantIds([]), []);
});

test("memoriesForCandidates projects synchronously from the snapshot", () => {
  const snapshot = staticMemory(new Map([
    [longTermMemoryUserIdFromTelegramSender(101).toPersistenceKey(),
      [{ text: "Іра працювала над цим тижнями" }]],
    [longTermMemoryUserIdFromTelegramSender(202).toPersistenceKey(),
      [{ text: "Макс любить еспресо" }]],
  ])).beginTurn().snapshot;
  const contexts = memoriesForCandidates(snapshot, candidates);
  const ira = contexts.find(({ participant }) => participant.id === 101);
  const max = contexts.find(({ participant }) => participant.id === 202);
  assert.equal(ira?.memories[0]?.text, "Іра працювала над цим тижнями");
  assert.equal(max?.memories[0]?.text, "Макс любить еспресо");
  assert.ok(!contexts.some(({ participant }) => participant.kind !== "user" || participant.id === -500));
});

test("older-target planning and realization receive attributed target memory", async () => {
  const memory = staticMemory(new Map([
    [longTermMemoryUserIdFromTelegramSender(101).toPersistenceKey(),
      [{ text: "Іра працювала над цим тижнями" }]],
    [longTermMemoryUserIdFromTelegramSender(202).toPersistenceKey(),
      [{ text: "Макс любить еспресо" }]],
  ]));
  let plannerCall = 0;
  const planner: SocialDecisionMaker = { decide: async (context) => {
    plannerCall += 1;
    if (plannerCall < 3) return { action: "silence" };
    const ira = context.participantMemories.find(({ participant }) => participant.id === 101);
    assert.equal(ira?.memories[0]?.text, "Іра працювала над цим тижнями");
    const max = context.participantMemories.find(({ participant }) => participant.id === 202);
    assert.equal(max?.memories[0]?.text, "Макс любить еспресо");
    assert.ok(!context.participantMemories.some(({ participant }) => participant.id === -500));
    return { action: "reply", targetCandidateKey: "candidate-0", motive: "pride",
      socialAction: "personal recognition", adviceRequested: false, askQuestion: false,
      dreamRelevant: false, backgroundRelevant: false };
  } };
  const model = fakeModel();
  model.respond((messages) => {
    const input = messages.map(({ content }) => String(content)).join("\n");
    assert.match(input, /Іра працювала над цим тижнями/);
    assert.doesNotMatch(input, /Макс любить еспресо/);
    return new AIMessage("я знала шо ти це зробиш");
  });
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-participant-memory-"));
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"), model,
    summaryModel: fakeModel(), decisionMaker: planner, lazyMemory: memory });
  const threadId = conversationThreadIdFromTelegramPrivateChat(92);
  try {
    await layer.respond({ threadId,
      message: message(1, { kind: "user", id: 101 }, "Іра", "я нарешті це зробила"),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await layer.respond({ threadId,
      message: message(2, { kind: "chat", id: -500 }, "Канал", "оголошення"),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    const turn = await layer.respond({ threadId,
      message: message(3, { kind: "user", id: 202 }, "Макс", "хтось буде каву?"),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "reply");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
