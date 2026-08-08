import {
  LONG_TERM_MEMORY_TOP_K,
  type LongTermMemory,
  type RecalledMemory,
} from "./index.js";

export async function recallForTurn(
  memory: LongTermMemory | undefined,
  userId: string,
  query: string,
): Promise<RecalledMemory[]> {
  if (memory === undefined) {
    return [];
  }
  try {
    const recalled = await memory.search(userId, query, LONG_TERM_MEMORY_TOP_K);
    console.log(`Recalled ${recalled.length} long-term memories`);
    return recalled;
  } catch {
    console.warn("Long-term memory retrieval failed; continuing without recalled memories");
    return [];
  }
}

export async function rememberSuccessfulTurn(
  memory: LongTermMemory | undefined,
  userId: string,
  threadId: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  if (memory === undefined) {
    return;
  }
  try {
    await memory.rememberTurn(userId, threadId, userMessage, assistantMessage);
  } catch {
    console.warn("Long-term memory ingestion failed; returning the generated reply");
  }
}
