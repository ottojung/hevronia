import assert from "node:assert/strict";
import { test } from "node:test";

import { GeneratedTurn } from "../src/generated-turn.js";
import { deliverGeneratedTurn } from "../src/telegram-delivery.js";

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
