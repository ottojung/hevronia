import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { SYSTEM_PROMPT } from "../src/personality.js";
import { createRealizer } from "../src/realizer.js";
import {
  longTermMemoryUserIdFromTelegramSender,
  conversationThreadIdFromTelegramPrivateChat,
} from "../src/identifiers.js";
import type { VisibleMessage } from "../src/realizer-schema.js";
import type { ObservedTelegramMessage, TelegramSenderIdentity } from "../src/telegram-event.js";
import { memoriesForCandidates, selectedParticipantIds } from "../src/participant-memory.js";
import { realizerSpeak, staticMemory, stubPlanner, testLayer } from "./memory-fixtures.js";

function message(id: number, sender: TelegramSenderIdentity, name: string, text: string): ObservedTelegramMessage {
  return { kind: "participant", messageId: id, sender, senderDisplayName: name,
    chatKind: "group", text, messageThreadId: null, replyTo: null,
    directlyAddressed: false };
}

const candidates: VisibleMessage[] = [
  { messageId: 1, sender: { kind: "user", id: 101 },
    senderDisplayName: "Іра", text: "я нарешті це зробила" },
  { messageId: 2, sender: { kind: "user", id: 202 },
    senderDisplayName: "Макс", text: "хтось буде каву?" },
  { messageId: 3, sender: { kind: "chat", id: -500 },
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

test("memoriesForCandidates drops participants with no recalled memories", () => {
  const snapshot = staticMemory(new Map([
    [longTermMemoryUserIdFromTelegramSender(101).toPersistenceKey(),
      [{ text: "Іра працювала над цим тижнями" }]],
  ])).beginTurn().snapshot;
  const contexts = memoriesForCandidates(snapshot, candidates);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0]?.participant.id, 101);
  assert.equal(contexts[0]?.memories.length, 1);
});

test("planner and realizer both receive all relevant participant memories", async () => {
  const memory = staticMemory(new Map([
    [longTermMemoryUserIdFromTelegramSender(101).toPersistenceKey(),
      [{ text: "Іра працювала над цим тижнями" }]],
    [longTermMemoryUserIdFromTelegramSender(202).toPersistenceKey(),
      [{ text: "Макс любить еспресо" }]],
  ]));
  let plannerCall = 0;
  const planner = stubPlanner((context) => {
    plannerCall += 1;
    const ira = context.participantMemories.find(({ participant }) => participant.id === 101);
    assert.equal(ira?.memories[0]?.text, "Іра працювала над цим тижнями");
    const max = context.participantMemories.find(({ participant }) => participant.id === 202);
    assert.equal(max?.memories[0]?.text, "Макс любить еспресо");
    assert.ok(!context.participantMemories.some(({ participant }) => participant.id === -500));
    return true;
  });
  const model = fakeModel();
  const captured: string[] = [];
  const replyHandler = (messages: BaseMessage[]) => {
    captured.push(messages.map((item) => typeof item.content === "string"
      ? item.content : JSON.stringify(item.content)).join("\n"));
    return new AIMessage(JSON.stringify({ decision: realizerSpeak({ message: "я знала шо ти це зробиш" }) }));
  };
  model.respond(replyHandler);
  model.respond(replyHandler);
  model.respond(replyHandler);
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-participant-memory-"));
  const layer = testLayer(path.join(dir, "db.sqlite"),
    { planner, realizer: createRealizer(model, SYSTEM_PROMPT), lazyMemory: memory });
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
    assert.equal(turn.outcome.action, "speak");
    assert.equal(plannerCall, 3);
    assert.equal(captured.length, 3);
    const last = captured[2] ?? "";
    assert.match(last, /Іра працювала над цим тижнями/);
    assert.match(last, /Макс любить еспресо/);
    assert.doesNotMatch(last, /telegram-user:/);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});