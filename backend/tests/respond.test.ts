import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_MODEL,
  geminiKeyFromEnv,
  modelFromEnv,
  openAiKeyFromEnv,
} from "../src/model.js";
import { extractText } from "../src/text.js";
import {
  isMissingGroupMessageAccessError,
  logBotIdentity,
} from "../src/telegram-config.js";

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

test("modelFromEnv returns the default model when unset", () => {
  delete process.env["HEVRONIA_MODEL"];
  assert.equal(modelFromEnv(), DEFAULT_MODEL);
});

test("modelFromEnv returns the configured override", () => {
  process.env["HEVRONIA_MODEL"] = "fake-model1";
  try {
    assert.equal(modelFromEnv(), "fake-model1");
  } finally {
    delete process.env["HEVRONIA_MODEL"];
  }
});

test("modelFromEnv ignores a blank override and uses the default", () => {
  process.env["HEVRONIA_MODEL"] = "   ";
  try {
    assert.equal(modelFromEnv(), DEFAULT_MODEL);
  } finally {
    delete process.env["HEVRONIA_MODEL"];
  }
});

test("geminiKeyFromEnv returns the configured key", () => {
  process.env["MY_GEMINI_API_KEY"] = "gem-key";
  try {
    assert.equal(geminiKeyFromEnv(), "gem-key");
  } finally {
    delete process.env["MY_GEMINI_API_KEY"];
  }
});

test("geminiKeyFromEnv throws a clear error when the key is missing", () => {
  delete process.env["MY_GEMINI_API_KEY"];
  assert.throws(() => geminiKeyFromEnv(), /MY_GEMINI_API_KEY is not set/);
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

test("startup rejects a bot that cannot observe ambient group messages", () => {
  assert.throws(() => logBotIdentity({ id: 999, first_name: "Хевронія",
    username: "hevronia_bot", can_read_all_group_messages: false }),
  isMissingGroupMessageAccessError);
});
