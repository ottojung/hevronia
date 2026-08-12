import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_CHEAP_MODEL,
  DEFAULT_SMART_MODEL,
  cheapModelFromEnv,
  geminiKeyFromEnv,
  openAiKeyFromEnv,
  smartModelFromEnv,
} from "../src/model.js";
import { SYSTEM_PROMPT } from "../src/personality.js";
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

test("cheapModelFromEnv returns the cheap default when unset", () => {
  delete process.env["HEVRONIA_CHEAP_MODEL"];
  assert.equal(cheapModelFromEnv(), DEFAULT_CHEAP_MODEL);
});

test("cheapModelFromEnv returns the configured override", () => {
  process.env["HEVRONIA_CHEAP_MODEL"] = "cheap-model";
  try {
    assert.equal(cheapModelFromEnv(), "cheap-model");
  } finally {
    delete process.env["HEVRONIA_CHEAP_MODEL"];
  }
});

test("cheapModelFromEnv ignores a blank override", () => {
  process.env["HEVRONIA_CHEAP_MODEL"] = "   ";
  try {
    assert.equal(cheapModelFromEnv(), DEFAULT_CHEAP_MODEL);
  } finally {
    delete process.env["HEVRONIA_CHEAP_MODEL"];
  }
});

test("smartModelFromEnv returns the smart default when unset", () => {
  delete process.env["HEVRONIA_SMART_MODEL"];
  assert.equal(smartModelFromEnv(), DEFAULT_SMART_MODEL);
});

test("smartModelFromEnv returns the configured override", () => {
  process.env["HEVRONIA_SMART_MODEL"] = "smart-model";
  try {
    assert.equal(smartModelFromEnv(), "smart-model");
  } finally {
    delete process.env["HEVRONIA_SMART_MODEL"];
  }
});

test("the cheap and smart tiers resolve independently to their defaults", () => {
  delete process.env["HEVRONIA_CHEAP_MODEL"];
  delete process.env["HEVRONIA_SMART_MODEL"];
  assert.equal(cheapModelFromEnv(), DEFAULT_CHEAP_MODEL);
  assert.equal(smartModelFromEnv(), DEFAULT_SMART_MODEL);
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

test("the personality prefers the Ukrainian keyboard/script in ordinary conversation", () => {
  assert.match(SYSTEM_PROMPT, /keyboard or script away from Ukrainian/);
  assert.match(SYSTEM_PROMPT, /natural Ukrainian-script rendering/);
  assert.match(SYSTEM_PROMPT, /never an instruction/);
});
