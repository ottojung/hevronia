import { createConversationLayer } from "./layer.js";
import type { ConversationLayer as ConversationLayerType } from "./conversation-types.js";
import {
  createMem0Store,
  type LongTermMemoryStore,
} from "./long-term-memory/index.js";
import { createLazyLongTermMemory, type LazyLongTermMemory } from "./long-term-memory/runtime.js";
import { geminiKeyFromEnv, openAiKeyFromEnv } from "./model.js";

export class ConversationLayerNotInitializedError extends Error {
  constructor() {
    super("Conversation layer has not been initialized");
    this.name = "ConversationLayerNotInitializedError";
  }
}

export function isConversationLayerNotInitializedError(
  error: unknown,
): error is ConversationLayerNotInitializedError {
  return error instanceof ConversationLayerNotInitializedError;
}

export interface ConversationLayerInitializationDependencies {
  createStore(): LongTermMemoryStore;
  createLayer(lazyMemory: LazyLongTermMemory): ConversationLayerType;
}

const productionDependencies: ConversationLayerInitializationDependencies = {
  createStore: () => createMem0Store(openAiKeyFromEnv(), geminiKeyFromEnv()),
  createLayer: (lazyMemory) => createConversationLayer({ lazyMemory }),
};

let sharedLayer: ConversationLayerType | undefined;
export function initializeConversationLayer(
  dependencies: ConversationLayerInitializationDependencies = productionDependencies,
): void {
  if (sharedLayer !== undefined) {
    return;
  }
  const store = dependencies.createStore();
  const lazyMemory = createLazyLongTermMemory({ store });
  sharedLayer = dependencies.createLayer(lazyMemory);
  console.log("Conversation layer initialized");
}

export function getConversationLayer(): ConversationLayerType {
  if (sharedLayer === undefined) {
    throw new ConversationLayerNotInitializedError();
  }
  return sharedLayer;
}

export async function closeConversationLayer(): Promise<void> {
  if (sharedLayer !== undefined) {
    const layer = sharedLayer;
    sharedLayer = undefined;
    await layer.close();
  }
}
