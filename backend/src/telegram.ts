import { Bot } from "grammy";

import { respond } from "./respond.js";
import { isTransientError, sleep } from "./retry.js";
import {
  conversationThreadIdFromTelegramPrivateChat,
  longTermMemoryUserIdFromTelegramSender,
} from "./identifiers.js";

const EXPECTED_NAME = "Хевронія";
const EXPECTED_USERNAME = "hevronia_bot";

export function tokenFromEnv(): string {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not set in the environment. " +
        "Provide the bot token before starting the bot.",
    );
  }
  return token;
}

export async function startBot(): Promise<void> {
  const bot = new Bot(tokenFromEnv());

  bot.api.config.use(async (prev, method, payload, signal) => {
    const maxAttempts = 5;
    for (let attempt = 1; ; attempt++) {
      try {
        return await prev(method, payload, signal);
      } catch (error) {
        if (attempt >= maxAttempts || signal?.aborted || !isTransientError(error)) {
          throw error;
        }
        const delayMs = 500 * attempt;
        console.warn(
          `Telegram API call "${method}" failed (attempt ${attempt}), retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
      }
    }
  });

  const me = await bot.api.getMe();
  console.log(
    `Authenticated with Telegram: id=${me.id}, name="${me.first_name}", username=@${me.username}`,
  );
  if (me.first_name !== EXPECTED_NAME || me.username !== EXPECTED_USERNAME) {
    console.warn(
      `Unexpected bot identity — expected "${EXPECTED_NAME}" / @${EXPECTED_USERNAME}, ` +
        `got "${me.first_name}" / @${me.username}`,
    );
  }

  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") {
      return;
    }
    const updateId = ctx.update.update_id;
    const messageId = ctx.message.message_id;
    console.log(`Handling private text message update=${updateId} message=${messageId}`);
    try {
      await ctx.replyWithChatAction("typing");
      const threadId = conversationThreadIdFromTelegramPrivateChat(ctx.chat.id);
      const userId = longTermMemoryUserIdFromTelegramSender(ctx.from.id);
      const turn = await respond({ threadId, userId, messageText: ctx.message.text });
      await ctx.reply(turn.replyText);
      console.log(`Handled message=${messageId}`);
      void turn.postSend();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`Failed to handle message=${messageId}: ${detail}`);
      await ctx
        .reply("Щось я зараз зависла. Спробуй ще раз за хвилину.")
        .catch(() => undefined);
    }
  });

  bot.catch((error) => {
    const detail = error.error instanceof Error ? error.error.message : String(error.error);
    console.error(`Error while processing update=${error.ctx.update.update_id}: ${detail}`);
  });

  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`Received ${signal}; stopping long polling...`);
    await bot.stop();
    console.log("Stopped cleanly.");
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));

  console.log("Starting long polling...");
  await bot.start({
    allowed_updates: ["message"],
    onStart: (botInfo) => {
      console.log(`Long polling started; listening as @${botInfo.username}`);
    },
  });
  console.log("Long polling stopped.");
}
