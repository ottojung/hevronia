import type { LazyLongTermMemory } from "./long-term-memory/runtime.js";
import { memoryUserIdForSender } from "./long-term-memory/operations.js";
import type { TelegramSenderIdentity } from "./telegram-event.js";

export function warmParticipant(
  lazyMemory: LazyLongTermMemory | undefined,
  sender: TelegramSenderIdentity,
): void {
  const userId = memoryUserIdForSender(sender);
  if (userId !== undefined) {
    lazyMemory?.warmUser(userId);
  }
}
