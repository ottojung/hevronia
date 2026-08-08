import { getConversationLayer } from "./memory.js";
import type { RespondInput } from "./memory.js";

export {
  closeConversationLayer,
  extractReplyText,
  extractText,
  getConversationLayer,
  MODEL,
  openAiKeyFromEnv,
} from "./memory.js";

export async function respond(input: RespondInput): Promise<string> {
  return getConversationLayer().respond(input);
}
