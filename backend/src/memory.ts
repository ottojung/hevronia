import { createConversationLayer, type ConversationLayer } from "./layer.js";

export { createConversationLayer } from "./layer.js";
export type { ConversationLayer, ConversationLayerOptions } from "./layer.js";
export { MODEL, openAiKeyFromEnv } from "./model.js";
export { COMPACTION, SUMMARY_PREFIX, SUMMARY_PROMPT } from "./summary.js";
export { extractReplyText, extractText } from "./text.js";

let sharedLayer: ConversationLayer | undefined;

export function getConversationLayer(): ConversationLayer {
  sharedLayer ??= createConversationLayer();
  return sharedLayer;
}

export async function closeConversationLayer(): Promise<void> {
  if (sharedLayer !== undefined) {
    const layer = sharedLayer;
    sharedLayer = undefined;
    await layer.close();
  }
}
