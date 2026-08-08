import assert from "node:assert/strict";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { test } from "node:test";

import type { ConversationStore } from "../src/conversation-store.js";
import { createConversationLayer } from "../src/layer.js";
import type { SocialDecisionMaker } from "../src/social-decision.js";
import { deliverGeneratedTurn } from "../src/telegram-delivery.js";
import { serializeTelegramEvent, type CanonicalTelegramEvent, type ObservedTelegramMessage } from "../src/telegram-event.js";
import { conversationThreadIdFromTelegramPrivateChat } from "../src/identifiers.js";

const threadId = conversationThreadIdFromTelegramPrivateChat(55);

function message(id: number, text: string): ObservedTelegramMessage {
  return { kind: "participant", messageId: id, sender: { kind: "user", id: 101 },
    senderDisplayName: "Іра", chatKind: "private", text, messageThreadId: null,
    replyTo: null, directlyAddressed: true };
}

test("confirmed outgoing persistence retries before the next planner context", async () => {
  const events: CanonicalTelegramEvent[] = [];
  let outgoingAttempts = 0;
  const store: ConversationStore = {
    append: async (_threadId, event) => {
      if (event.kind === "hevronia" && ++outgoingAttempts === 1) {
        throw new Error("temporary checkpoint failure");
      }
      if (!events.some(({ kind, messageId }) => kind === event.kind && messageId === event.messageId)) {
        events.push(event);
      }
    },
    getMessages: async () => events.map((event) => new HumanMessage({
      content: serializeTelegramEvent(event), id: `${event.kind}:${event.messageId}`,
    })),
  };
  let plannerCall = 0;
  let laterSawReply = false;
  const planner: SocialDecisionMaker = { decide: async (context) => {
    plannerCall += 1;
    if (plannerCall === 1) return { action: "reply", targetCandidateKey: "candidate-0",
      motive: "care", socialAction: "reaction", adviceRequested: false,
      askQuestion: false, dreamRelevant: false, backgroundRelevant: false };
    laterSawReply = context.boundedHistory.some(({ content }) =>
      String(content).includes("доставлена відповідь"));
    return { action: "silence" };
  } };
  const model = fakeModel();
  model.respond(new AIMessage("доставлена відповідь"));
  const layer = createConversationLayer({ model, summaryModel: fakeModel(),
    conversationStore: store, decisionMaker: planner });
  try {
    const turn = await layer.respond({ threadId, message: message(1, "важлива річ"),
      hevroniaSender: { kind: "user", id: 999 } });
    let sends = 0;
    const result = await deliverGeneratedTurn(turn, { showTyping: async () => undefined,
      reply: async () => { sends += 1; return 2; } });
    assert.deepEqual(result, { status: "delivered", persistence: "queued" });
    await layer.respond({ threadId, message: message(3, "наступне"),
      hevroniaSender: { kind: "user", id: 999 } });
    assert.equal(outgoingAttempts, 2);
    assert.equal(events.filter(({ kind }) => kind === "hevronia").length, 1);
    assert.equal(laterSawReply, true);
    assert.equal(sends, 1);
  } finally {
    await layer.close();
  }
});
