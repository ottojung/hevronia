import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationLayer } from "../src/conversation-types.js";
import { GeneratedTurn } from "../src/generated-turn.js";
import type { LongTermMemory } from "../src/long-term-memory/index.js";
import { PendingMemoryWrites } from "../src/long-term-memory/pending.js";
import {
  closeConversationLayer,
  getConversationLayer,
  initializeConversationLayer,
  isConversationLayerNotInitializedError,
} from "../src/memory.js";

function fakeLongTermMemory(): LongTermMemory {
  return {
    search: async () => [],
    rememberTurn: async () => undefined,
    deleteAll: async () => undefined,
  };
}

function fakeConversationLayer(): ConversationLayer {
  return {
    respond: async () =>
      GeneratedTurn.fromGeneratedResponse(
        "reply",
        async () => undefined,
        new PendingMemoryWrites(),
      ),
    getMessages: async () => [],
    close: async () => undefined,
  };
}

test("production initialization waits for Qdrant before constructing Mem0", async () => {
  const events: string[] = [];
  process.env["MY_OPENAI_API_KEY"] = "test-key";
  try {
    assert.throws(() => getConversationLayer(), isConversationLayerNotInitializedError);
    await initializeConversationLayer({
      waitForReady: async () => {
        events.push("ready");
      },
      createLongTermMemory: () => {
        events.push("memory");
        return fakeLongTermMemory();
      },
      createLayer: () => {
        events.push("layer");
        return fakeConversationLayer();
      },
    });
    await initializeConversationLayer({
      waitForReady: async () => {
        events.push("unexpected");
      },
      createLongTermMemory: fakeLongTermMemory,
      createLayer: fakeConversationLayer,
    });
    assert.deepEqual(events, ["ready", "memory", "layer"]);
    assert.equal(getConversationLayer(), getConversationLayer());
  } finally {
    delete process.env["MY_OPENAI_API_KEY"];
    await closeConversationLayer();
  }
});
