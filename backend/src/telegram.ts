import { Bot } from "grammy";

import { respond } from "./respond.js";
import { isTransientError, sleep } from "./retry.js";
import {
  conversationThreadIdFromTelegramGroupChat,
  conversationThreadIdFromTelegramPrivateChat,
  longTermMemoryUserIdFromTelegramSender,
} from "./identifiers.js";
import { deliverGeneratedTurn } from "./telegram-delivery.js";
import { logBotIdentity, tokenFromEnv } from "./telegram-config.js";
export { tokenFromEnv } from "./telegram-config.js";

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
  logBotIdentity(me);

  bot.on("message:text", async (ctx) => {
    const updateId = ctx.update.update_id;
    const messageId = ctx.message.message_id;
    console.log(`Handling private text message update=${updateId} message=${messageId}`);
    try {
      const threadId = ctx.chat.type === "private"
        ? conversationThreadIdFromTelegramPrivateChat(ctx.chat.id)
        : conversationThreadIdFromTelegramGroupChat(ctx.chat.id);
      const userId = longTermMemoryUserIdFromTelegramSender(ctx.from.id);
      const turn = await respond({
        threadId,
        userId,
        messageId,
        speakerName: ctx.from.first_name,
        messageText: ctx.message.text,
      });
      const sent = await deliverGeneratedTurn(turn, {
        showTyping: async () => {
          await ctx.replyWithChatAction("typing");
        },
        reply: async (text, replyToMessageId) => {
          await ctx.reply(text, { reply_parameters: { message_id: replyToMessageId } });
        },
      });
      if (!sent) {
        console.log(`Observed message=${messageId}; chose silence`);
        void turn.postSend();
        return;
      }
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
