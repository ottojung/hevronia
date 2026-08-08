import assert from "node:assert/strict";
import { test } from "node:test";

import { openAiKeyFromEnv } from "../src/model.js";
import { extractReplyText, extractText } from "../src/text.js";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

const FAKE_KEY = "sk-test-key-value-that-must-not-leak";

test("openAiKeyFromEnv returns the configured key", () => {
  process.env["MY_OPENAI_API_KEY"] = FAKE_KEY;
  try {
    assert.equal(openAiKeyFromEnv(), FAKE_KEY);
  } finally {
    delete process.env["MY_OPENAI_API_KEY"];
  }
});

test("openAiKeyFromEnv throws a clear error when the key is missing", () => {
  delete process.env["MY_OPENAI_API_KEY"];
  assert.throws(() => openAiKeyFromEnv(), /MY_OPENAI_API_KEY is not set/);
});

test("openAiKeyFromEnv error does not reveal any key value", () => {
  delete process.env["MY_OPENAI_API_KEY"];
  try {
    openAiKeyFromEnv();
    assert.fail("expected openAiKeyFromEnv to throw");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(FAKE_KEY));
    assert.ok(!error.message.includes("sk-"));
  }
});

test("extractText returns string content unchanged", () => {
  assert.equal(extractText("Привіт, світе"), "Привіт, світе");
});

test("extractText joins text blocks and skips non-text blocks", () => {
  assert.equal(
    extractText([
      { type: "text", text: "Перший" },
      { type: "reasoning", reasoning: "невидимі думки" },
      { type: "text", text: " другий" },
    ]),
    "Перший другий",
  );
});

test("extractText returns empty string when content has no text", () => {
  assert.equal(extractText([{ type: "reasoning", reasoning: "думки" }]), "");
});

test("extractText returns empty string for empty content", () => {
  assert.equal(extractText([]), "");
});

test("extractReplyText returns the text of the last AI message", () => {
  const messages = [new HumanMessage("привіт"), new AIMessage("Вітаю.")];
  assert.equal(extractReplyText(messages), "Вітаю.");
});

test("extractReplyText throws when the agent produced no text", () => {
  const messages = [new HumanMessage("привіт"), new AIMessage("")];
  assert.throws(() => extractReplyText(messages), /no text reply/);
});
