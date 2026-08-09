import type { LongTermMemoryUserId } from "../identifiers.js";
import { longTermMemoryUserIdFromTelegramSender } from "../identifiers.js";
import type { TelegramSenderIdentity } from "../telegram-event.js";

export function memoryUserIdForSender(
  sender: TelegramSenderIdentity,
): LongTermMemoryUserId | undefined {
  return sender.kind === "user" ? longTermMemoryUserIdFromTelegramSender(sender.id) : undefined;
}

export function operationalErrorDetail(error: unknown): string {
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
