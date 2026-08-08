import { createConversationLayer } from "./layer.js";
import type { ConversationLayer as ConversationLayerType } from "./conversation-types.js";
import { createMem0LongTermMemory } from "./long-term-memory/index.js";

export { createConversationLayer } from "./layer.js";
export type { ConversationLayer, ConversationLayerOptions, RespondInput } from "./conversation-types.js";
export { MODEL, openAiKeyFromEnv } from "./model.js";
export { COMPACTION, SUMMARY_PREFIX, SUMMARY_PROMPT } from "./summary.js";
export { extractReplyText, extractText } from "./text.js";

let sharedLayer: ConversationLayerType | undefined;

export function getConversationLayer(): ConversationLayerType {
  sharedLayer ??= createConversationLayer({ longTermMemory: createMem0LongTermMemory() });
  return sharedLayer;
}

export async function closeConversationLayer(): Promise<void> {
  if (sharedLayer !== undefined) {
    const layer = sharedLayer;
    sharedLayer = undefined;
    await layer.close();
  }
}
