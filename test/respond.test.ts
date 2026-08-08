import assert from "node:assert/strict";
import { test } from "node:test";

import { respond } from "../src/respond.ts";

test("respond echoes the message with the expected Ukrainian template", () => {
  assert.equal(respond("привіт"), "Ти сказала: привіт");
});

test("respond handles an empty message", () => {
  assert.equal(respond(""), "Ти сказала: ");
});

test("respond preserves Unicode input", () => {
  assert.equal(respond("Хевронія, 你好 🎉"), "Ти сказала: Хевронія, 你好 🎉");
});
