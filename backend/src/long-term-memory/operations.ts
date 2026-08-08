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
  } catch (error) {
    console.warn(`Long-term-memory search failed: ${operationalErrorDetail(error)}`);
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
  } catch (error) {
    console.warn(`Long-term-memory ingestion failed: ${operationalErrorDetail(error)}`);
  }
}

function operationalErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) {
    return "non-Error failure";
  }
  let detail = `${error.name}: ${error.message}`;
  for (const secretName of ["MY_OPENAI_API_KEY", "TELEGRAM_BOT_TOKEN"]) {
    const secret = process.env[secretName];
    if (secret) {
      detail = detail.replaceAll(secret, "[redacted]");
    }
  }
  return detail;
}
