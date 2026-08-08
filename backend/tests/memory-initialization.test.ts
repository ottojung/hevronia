import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationLayer } from "../src/conversation-types.js";
import { GeneratedTurn } from "../src/generated-turn.js";
import type { LongTermMemory } from "../src/long-term-memory/index.js";
import {
  closeConversationLayer,
  getConversationLayer,
  initializeConversationLayer,
  isConversationLayerNotInitializedError,
} from "../src/memory.js";

function fakeLongTermMemory(): LongTermMemory {
  return {
    search: async () => [],
    rememberUserMessage: async () => undefined,
    deleteAll: async () => undefined,
  };
}

function fakeConversationLayer(close = async () => undefined): ConversationLayer {
  return {
    respond: async () => GeneratedTurn.fromSilence(),
    recordDeliveredMessage: async () => undefined,
    getMessages: async () => [],
    close,
  };
}

test("initialization constructs memory and the conversation layer once", async () => {
  const events: string[] = [];
  process.env["MY_OPENAI_API_KEY"] = "test-key";
  try {
    assert.throws(() => getConversationLayer(), isConversationLayerNotInitializedError);
    initializeConversationLayer({
      createLongTermMemory: (apiKey) => {
        assert.equal(apiKey, "test-key");
        events.push("memory");
        return fakeLongTermMemory();
      },
      createLayer: () => {
        events.push("layer");
        return fakeConversationLayer();
      },
    });
    initializeConversationLayer({
      createLongTermMemory: () => {
        events.push("unexpected");
        return fakeLongTermMemory();
      },
      createLayer: () => fakeConversationLayer(),
    });
    assert.deepEqual(events, ["memory", "layer"]);
    assert.equal(getConversationLayer(), getConversationLayer());
  } finally {
    delete process.env["MY_OPENAI_API_KEY"];
    await closeConversationLayer();
  }
});

test("closing resets the shared conversation layer", async () => {
  let closeCount = 0;
  process.env["MY_OPENAI_API_KEY"] = "test-key";
  try {
    initializeConversationLayer({
      createLongTermMemory: fakeLongTermMemory,
      createLayer: () => fakeConversationLayer(async () => { closeCount += 1; }),
    });
    await closeConversationLayer();
    assert.equal(closeCount, 1);
    assert.throws(() => getConversationLayer(), isConversationLayerNotInitializedError);
  } finally {
    delete process.env["MY_OPENAI_API_KEY"];
    await closeConversationLayer();
  }
});
