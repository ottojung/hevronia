import assert from "node:assert/strict";
import { test } from "node:test";

import { GeneratedTurn } from "../src/generated-turn.js";
import { deliverFallbackMessage, deliverGeneratedTurn } from "../src/telegram-delivery.js";
import type { DeliveredHevroniaMessage } from "../src/telegram-event.js";

test("confirmed Telegram delivery is not retried when state persistence fails", async () => {
  const sent: string[] = [];
  const turn = GeneratedTurn.fromReply("реальна відповідь", { targetMessageId: 10, targetSenderId: 101, targetSenderDisplayName: "Іра", targetText: "текст" }, async () => {
    throw new Error("checkpoint unavailable");
  });
  const result = await deliverGeneratedTurn(turn, {
    showTyping: async () => undefined,
    reply: async (text) => { sent.push(text); return 20; },
  });
  assert.deepEqual(result, { status: "delivered", persistence: "failed" });
  assert.deepEqual(sent, ["реальна відповідь"]);
});

test("intentional delivered fallback is persisted as a canonical Hevronia event", async () => {
  const persisted: DeliveredHevroniaMessage[] = [];
  const result = await deliverFallbackMessage({ text: "Щось я зараз зависла.",
    senderId: 999, chatKind: "group", replyTo: { targetMessageId: 10,
      targetSenderId: 101, targetSenderDisplayName: "Іра", targetText: "привіт" } }, {
    showTyping: async () => undefined,
    reply: async () => 21,
  }, async (message) => { persisted.push(message); });
  assert.deepEqual(result, { status: "delivered", persistence: "stored" });
  assert.deepEqual(persisted, [{ kind: "hevronia", messageId: 21, senderId: 999,
    senderDisplayName: "Хевронія", chatKind: "group", text: "Щось я зараз зависла.",
    replyTo: { targetMessageId: 10, targetSenderId: 101,
      targetSenderDisplayName: "Іра", targetText: "привіт" } }]);
});

test("failed Telegram reply never invokes outgoing persistence", async () => {
  let persisted = false;
  const turn = GeneratedTurn.fromReply("недоставлена", { targetMessageId: 10, targetSenderId: 101, targetSenderDisplayName: "Іра", targetText: "текст" }, async () => {
    persisted = true;
  });
  await assert.rejects(() => deliverGeneratedTurn(turn, {
    showTyping: async () => undefined,
    reply: async () => { throw new Error("Telegram unavailable"); },
  }));
  assert.equal(persisted, false);
});
