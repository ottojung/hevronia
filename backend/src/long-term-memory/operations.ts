import {
  LONG_TERM_MEMORY_TOP_K,
  type LongTermMemory,
  type RecalledMemory,
} from "./index.js";
import type { ConversationThreadId, LongTermMemoryUserId } from "../identifiers.js";
import { longTermMemoryUserIdFromTelegramSender } from "../identifiers.js";
import type { TelegramSenderIdentity } from "../telegram-event.js";
import type { PendingMemoryWrites } from "./pending.js";

export async function recallForTurn(
  memory: LongTermMemory | undefined,
  userId: LongTermMemoryUserId,
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

export function memoryUserIdForSender(
  sender: TelegramSenderIdentity,
): LongTermMemoryUserId | undefined {
  return sender.kind === "user" ? longTermMemoryUserIdFromTelegramSender(sender.id) : undefined;
}

export function scheduleRememberedMessage(
  pending: PendingMemoryWrites,
  memory: LongTermMemory | undefined,
  userId: LongTermMemoryUserId | undefined,
  threadId: ConversationThreadId,
  text: string,
): void {
  if (userId === undefined) return;
  void pending.track(rememberDeliveredUserMessage(memory, userId, threadId, text));
}

export async function rememberDeliveredUserMessage(
  memory: LongTermMemory | undefined,
  userId: LongTermMemoryUserId,
  threadId: ConversationThreadId,
  userMessage: string,
): Promise<void> {
  if (memory === undefined) {
    return;
  }
  try {
    await memory.rememberUserMessage(userId, threadId, userMessage);
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
