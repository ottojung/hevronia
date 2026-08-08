import { createConversationLayer } from "./layer.js";
import type { ConversationLayer as ConversationLayerType } from "./conversation-types.js";
import {
  createMem0LongTermMemory,
  type LongTermMemory,
  type Mem0LongTermMemoryOptions,
} from "./long-term-memory/index.js";
import { qdrantUrlFromEnv, waitForQdrantReady } from "./long-term-memory/qdrant.js";
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
  waitForReady(qdrantUrl: string): Promise<void>;
  createLongTermMemory(options: Mem0LongTermMemoryOptions): LongTermMemory;
  createLayer(longTermMemory: LongTermMemory): ConversationLayerType;
}

const productionDependencies: ConversationLayerInitializationDependencies = {
  waitForReady: waitForQdrantReady,
  createLongTermMemory: createMem0LongTermMemory,
  createLayer: (longTermMemory) => createConversationLayer({ longTermMemory }),
};

let sharedLayer: ConversationLayerType | undefined;
let initialization: Promise<void> | undefined;

export async function initializeConversationLayer(
  dependencies: ConversationLayerInitializationDependencies = productionDependencies,
): Promise<void> {
  if (sharedLayer !== undefined) {
    return;
  }
  initialization ??= initialize(dependencies);
  try {
    await initialization;
  } catch (error) {
    initialization = undefined;
    throw error;
  }
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
    initialization = undefined;
    await layer.close();
  }
}

async function initialize(
  dependencies: ConversationLayerInitializationDependencies,
): Promise<void> {
  const apiKey = openAiKeyFromEnv();
  const qdrantUrl = qdrantUrlFromEnv();
  await dependencies.waitForReady(qdrantUrl);
  const longTermMemory = dependencies.createLongTermMemory({ apiKey, qdrantUrl });
  sharedLayer = dependencies.createLayer(longTermMemory);
  console.log("Conversation layer initialized");
}
