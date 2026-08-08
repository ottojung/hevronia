import { createConversationLayer } from "./layer.js";
import type { ConversationLayer as ConversationLayerType } from "./conversation-types.js";
import {
  createMem0LongTermMemory,
  type LongTermMemory,
} from "./long-term-memory/index.js";
import { openAiKeyFromEnv } from "./model.js";

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
  createLongTermMemory(apiKey: string): LongTermMemory;
  createLayer(longTermMemory: LongTermMemory): ConversationLayerType;
}

const productionDependencies: ConversationLayerInitializationDependencies = {
  createLongTermMemory: createMem0LongTermMemory,
  createLayer: (longTermMemory) => createConversationLayer({ longTermMemory }),
};

let sharedLayer: ConversationLayerType | undefined;
export function initializeConversationLayer(
  dependencies: ConversationLayerInitializationDependencies = productionDependencies,
): void {
  if (sharedLayer !== undefined) {
    return;
  }
  const apiKey = openAiKeyFromEnv();
  const longTermMemory = dependencies.createLongTermMemory(apiKey);
  sharedLayer = dependencies.createLayer(longTermMemory);
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
