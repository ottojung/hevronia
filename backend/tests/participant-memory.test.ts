import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { createConversationLayer } from "../src/layer.js";
import type { LongTermMemory } from "../src/long-term-memory/index.js";
import type { SocialDecisionMaker } from "../src/social-decision.js";
import type { ObservedTelegramMessage, TelegramSenderIdentity } from "../src/telegram-event.js";
import { conversationThreadIdFromTelegramPrivateChat } from "../src/identifiers.js";

function message(id: number, sender: TelegramSenderIdentity, name: string, text: string): ObservedTelegramMessage {
  return { kind: "participant", messageId: id, sender, senderDisplayName: name,
    chatKind: "group", text, messageThreadId: null, replyTo: null,
    directlyAddressed: false };
}

test("older-target planning and realization receive attributed target memory", async () => {
  const searched: string[] = [];
  const memory: LongTermMemory = {
    search: async (userId) => {
      const key = userId.toPersistenceKey();
      searched.push(key);
      return [{ text: key.endsWith(":101") ? "Іра працювала над цим тижнями"
        : "Макс любить еспресо" }];
    },
    rememberUserMessage: async () => undefined,
    deleteAll: async () => undefined,
  };
  let plannerCall = 0;
  const planner: SocialDecisionMaker = { decide: async (context) => {
    plannerCall += 1;
    if (plannerCall < 3) return { action: "silence" };
    const ira = context.participantMemories.find(({ participant }) => participant.id === 101);
    assert.equal(ira?.memories[0]?.text, "Іра працювала над цим тижнями");
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
    summaryModel: fakeModel(), decisionMaker: planner, longTermMemory: memory });
  const threadId = conversationThreadIdFromTelegramPrivateChat(92);
  try {
    await layer.respond({ threadId,
      message: message(1, { kind: "user", id: 101 }, "Іра", "я нарешті це зробила"),
      hevroniaSender: { kind: "user", id: 999 } });
    await layer.respond({ threadId,
      message: message(2, { kind: "chat", id: -500 }, "Канал", "оголошення"),
      hevroniaSender: { kind: "user", id: 999 } });
    const turn = await layer.respond({ threadId,
      message: message(3, { kind: "user", id: 202 }, "Макс", "хтось буде каву?"),
      hevroniaSender: { kind: "user", id: 999 } });
    assert.equal(turn.outcome.action, "reply");
    assert.ok(searched.every((key) => key === "telegram-user:101" || key === "telegram-user:202"));
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
