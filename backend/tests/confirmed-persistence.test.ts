import assert from "node:assert/strict";
import { HumanMessage } from "@langchain/core/messages";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { ConversationStore } from "../src/conversation-store.js";
import type { Realizer } from "../src/realizer.js";
import { deliverGeneratedTurn } from "../src/telegram-delivery.js";
import { serializeTelegramEvent, type CanonicalTelegramEvent, type ObservedTelegramMessage } from "../src/telegram-event.js";
import { conversationThreadIdFromTelegramPrivateChat } from "../src/identifiers.js";
import { realizerSilence, realizerSpeak, stubPlanner, testLayer } from "./memory-fixtures.js";

const threadId = conversationThreadIdFromTelegramPrivateChat(55);

function message(id: number, text: string): ObservedTelegramMessage {
  return { kind: "participant", messageId: id, sender: { kind: "user", id: 101 },
    senderDisplayName: "Іра", senderUsername: null, chatKind: "group", text, messageThreadId: null,
    replyTo: null, directlyAddressed: false };
}

test("confirmed outgoing persistence retries before the next planner context", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-persist-"));
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
  const planner = stubPlanner((context) => {
    plannerCall += 1;
    if (plannerCall > 1) {
      laterSawReply = context.boundedHistory.some(({ content }) =>
        String(content).includes("доставлена відповідь"));
    }
    return true;
  });
  let realizerCall = 0;
  const realizer: Realizer = {
    realize: async () => {
      realizerCall += 1;
      if (realizerCall === 1) return realizerSpeak({ message: "доставлена відповідь" });
      return realizerSilence();
    },
  };
  const layer = testLayer(path.join(dir, "db.sqlite"),
    { planner, realizer, conversationStore: store });
  try {
    const turn = await layer.respond({ threadId, message: message(1, "важлива річ"),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    let sends = 0;
    const result = await deliverGeneratedTurn(turn, { showTyping: async () => undefined,
      reply: async () => { sends += 1; return 2; } });
    assert.deepEqual(result, { status: "delivered", persistence: "queued" });
    await layer.respond({ threadId, message: message(3, "наступне"),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(outgoingAttempts, 2);
    assert.equal(events.filter(({ kind }) => kind === "hevronia").length, 1);
    assert.equal(laterSawReply, true);
    assert.equal(sends, 1);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("incoming canonical persistence recovers before planning", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-persist-"));
  const events: CanonicalTelegramEvent[] = [];
  let attempts = 0;
  let planned = false;
  const store: ConversationStore = {
    append: async (_threadId, event) => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary incoming failure");
      if (!events.some(({ kind, messageId }) => kind === event.kind && messageId === event.messageId)) {
        events.push(event);
      }
    },
    getMessages: async () => events.map((event) => new HumanMessage({
      content: serializeTelegramEvent(event), id: `${event.kind}:${event.messageId}`,
    })),
  };
  const planner = stubPlanner((context) => {
    planned = true;
    assert.equal(context.boundedHistory.length, 1);
    return false;
  });
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner, conversationStore: store });
  try {
    await layer.respond({ threadId, message: message(4, "вхідне"),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(attempts, 2);
    assert.equal(planned, true);
    assert.equal(events.filter(({ kind }) => kind === "participant").length, 1);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
