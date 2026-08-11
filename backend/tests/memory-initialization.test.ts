import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationLayer } from "../src/conversation-types.js";
import { GeneratedTurn } from "../src/generated-turn.js";
import type { LongTermMemoryStore } from "../src/long-term-memory/index.js";
import {
  closeConversationLayer,
  getConversationLayer,
  initializeConversationLayer,
  isConversationLayerNotInitializedError,
} from "../src/memory.js";

function fakeStore(): LongTermMemoryStore {
  return {
    search: async () => [],
    rememberUserMessage: async () => [],
    deleteAll: async () => undefined,
  };
}

function fakeConversationLayer(close = async () => undefined): ConversationLayer {
  return {
    respond: async () => GeneratedTurn.fromSilence(),
    recordDeliveredMessage: async () => undefined,
    getMessages: async () => [],
    warmParticipant: () => undefined,
    close,
  };
}

test("initialization constructs the store, runtime, and layer once", async () => {
  const events: string[] = [];
  assert.throws(() => getConversationLayer(), isConversationLayerNotInitializedError);
  initializeConversationLayer({
    createStore: () => {
      events.push("store");
      return fakeStore();
    },
    createLayer: (lazyMemory) => {
      assert.equal(lazyMemory, lazyMemory);
      events.push("layer");
      return fakeConversationLayer();
    },
  });
  initializeConversationLayer({
    createStore: () => {
      events.push("unexpected");
      return fakeStore();
    },
    createLayer: () => fakeConversationLayer(),
  });
  assert.deepEqual(events, ["store", "layer"]);
  assert.equal(getConversationLayer(), getConversationLayer());
  await closeConversationLayer();
});

test("closing resets the shared conversation layer", async () => {
  let closeCount = 0;
  initializeConversationLayer({
    createStore: fakeStore,
    createLayer: (lazyMemory) => {
      assert.ok(lazyMemory);
      return fakeConversationLayer(async () => { closeCount += 1; });
    },
  });
  await closeConversationLayer();
  assert.equal(closeCount, 1);
  assert.throws(() => getConversationLayer(), isConversationLayerNotInitializedError);
  await closeConversationLayer();
});
