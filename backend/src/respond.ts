import { getConversationLayer } from "./memory.js";
import type { RespondInput } from "./memory.js";
import type { GeneratedTurn } from "./generated-turn.js";

export {
  closeConversationLayer,
  extractReplyText,
  extractText,
  getConversationLayer,
  initializeConversationLayer,
  MODEL,
  openAiKeyFromEnv,
} from "./memory.js";

export async function respond(input: RespondInput): Promise<GeneratedTurn> {
  return getConversationLayer().respond(input);
}
