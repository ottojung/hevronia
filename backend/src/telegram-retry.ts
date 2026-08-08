import type { Bot } from "grammy";

import { isTransientError, sleep } from "./retry.js";

export function installTelegramRetry(bot: Bot): void {
  bot.api.config.use(async (prev, method, payload, signal) => {
    const maxAttempts = 5;
    for (let attempt = 1; ; attempt++) {
      try {
        return await prev(method, payload, signal);
      } catch (error) {
        if (attempt >= maxAttempts || signal?.aborted || !isTransientError(error)) throw error;
        const delayMs = 500 * attempt;
        console.warn(
          `Telegram API call "${method}" failed (attempt ${attempt}), retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
      }
    }
  });
}
