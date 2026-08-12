import assert from "node:assert/strict";
import { test } from "node:test";

import { GeneratedTurn } from "../src/generated-turn.js";
import { deliverFallbackMessage, deliverGeneratedTurn } from "../src/telegram-delivery.js";
import type { DeliveredHevroniaMessage } from "../src/telegram-event.js";

test("intentional delivered fallback is persisted as a canonical Hevronia event", async () => {
  const persisted: DeliveredHevroniaMessage[] = [];
  const result = await deliverFallbackMessage({ text: "Щось я зараз зависла.",
    sender: { kind: "user", id: 999 }, chatKind: "group", messageThreadId: null,
    replyTo: { targetMessageId: 10,
      targetSender: { kind: "user", id: 101 }, targetSenderDisplayName: "Іра",
      targetSenderUsername: null, targetText: "привіт",
      targetIsHevronia: false } }, {
    showTyping: async () => undefined,
    reply: async () => 21,
  }, (message) => { persisted.push(message); });
  assert.deepEqual(result, { status: "delivered", persistence: "queued" });
  assert.deepEqual(persisted, [{ kind: "hevronia", messageId: 21,
    sender: { kind: "user", id: 999 }, senderDisplayName: "Хевронія", senderUsername: null,
    chatKind: "group", messageThreadId: null, text: "Щось я зараз зависла.",
    replyTo: { targetMessageId: 10, targetSender: { kind: "user", id: 101 },
      targetSenderDisplayName: "Іра", targetSenderUsername: null, targetText: "привіт",
      targetIsHevronia: false } }]);
});

test("failed Telegram reply never invokes outgoing persistence", async () => {
  let persisted = false;
  const turn = GeneratedTurn.fromSpeak("недоставлена", { targetMessageId: 10, targetSender: { kind: "user", id: 101 }, targetSenderDisplayName: "Іра", targetSenderUsername: null, targetText: "текст", targetIsHevronia: false }, async () => {
    persisted = true;
  });
  await assert.rejects(() => deliverGeneratedTurn(turn, {
    showTyping: async () => undefined,
    reply: async () => { throw new Error("Telegram unavailable"); },
  }));
  assert.equal(persisted, false);
});

test("an ended turn delivers nothing and never shows typing", async () => {
  const turn = GeneratedTurn.fromEnd();
  let touched = false;
  const result = await deliverGeneratedTurn(turn, {
    showTyping: async () => { touched = true; },
    reply: async () => { touched = true; return 1; },
  });
  assert.deepEqual(result, { status: "silence" });
  assert.equal(touched, false);
});
