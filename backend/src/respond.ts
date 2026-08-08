import { getConversationLayer } from "./memory.js";

export {
  closeConversationLayer,
  extractReplyText,
  extractText,
  getConversationLayer,
  MODEL,
  openAiKeyFromEnv,
} from "./memory.js";

export async function respond(threadId: string, messageText: string): Promise<string> {
  return getConversationLayer().respond(threadId, messageText);
}
