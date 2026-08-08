import { getConversationLayer } from "./memory.js";
import type { RespondInput } from "./conversation-types.js";
import type { GeneratedTurn } from "./generated-turn.js";

export async function respond(input: RespondInput): Promise<GeneratedTurn> {
  return getConversationLayer().respond(input);
}
