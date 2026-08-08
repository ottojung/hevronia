import assert from "node:assert/strict";
import { test } from "node:test";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { SYSTEM_PROMPT } from "../src/personality.ts";
import { buildMessages, extractText, openAiKeyFromEnv } from "../src/respond.ts";

const FAKE_KEY = "sk-test-key-value-that-must-not-leak";

test("openAiKeyFromEnv returns the configured key", () => {
  process.env.MY_OPENAI_API_KEY = FAKE_KEY;
  try {
    assert.equal(openAiKeyFromEnv(), FAKE_KEY);
  } finally {
    delete process.env.MY_OPENAI_API_KEY;
  }
});

test("openAiKeyFromEnv throws a clear error when the key is missing", () => {
  delete process.env.MY_OPENAI_API_KEY;
  assert.throws(() => openAiKeyFromEnv(), /MY_OPENAI_API_KEY is not set/);
});

test("openAiKeyFromEnv error does not reveal any key value", () => {
  delete process.env.MY_OPENAI_API_KEY;
  try {
    openAiKeyFromEnv();
    assert.fail("expected openAiKeyFromEnv to throw");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(FAKE_KEY));
    assert.ok(!error.message.includes("sk-"));
  }
});

test("buildMessages builds a system and a human message", () => {
  const [system, human] = buildMessages("привіт");
  assert.ok(system instanceof SystemMessage);
  assert.equal(system.content, SYSTEM_PROMPT);
  assert.ok(human instanceof HumanMessage);
  assert.equal(human.content, "привіт");
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
