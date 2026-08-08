import { Bot } from "grammy";

import { recordDeliveredMessage, respond } from "./respond.js";
import { conversationThreadIdFromTelegramGroupChat, conversationThreadIdFromTelegramPrivateChat } from "./identifiers.js";
import { deliverFallbackMessage, deliverGeneratedTurn } from "./telegram-delivery.js";
import { logBotIdentity, tokenFromEnv } from "./telegram-config.js";
import { createObservedTelegramMessage } from "./telegram-observation.js";
import { installTelegramRetry } from "./telegram-retry.js";
export { tokenFromEnv } from "./telegram-config.js";

export async function startBot(): Promise<void> {
  const bot = new Bot(tokenFromEnv());

  installTelegramRetry(bot);

  const me = await bot.api.getMe();
  logBotIdentity(me);

  bot.on("message:text", async (ctx) => {
    const updateId = ctx.update.update_id;
    const messageId = ctx.message.message_id;
    console.log(`Handling Telegram text message update=${updateId} message=${messageId}`);
    try {
      const threadId = ctx.chat.type === "private"
        ? conversationThreadIdFromTelegramPrivateChat(ctx.chat.id)
        : conversationThreadIdFromTelegramGroupChat(ctx.chat.id);
      const reply = ctx.message.reply_to_message;
      const displayName = displayNameFrom(ctx.from.first_name, ctx.from.last_name);
      const message = createObservedTelegramMessage({
        messageId, senderId: ctx.from.id, senderDisplayName: displayName,
        chatKind: ctx.chat.type, text: ctx.message.text,
        replyTo: reply === undefined ? null : {
          targetMessageId: reply.message_id, targetSenderId: reply.from?.id ?? ctx.chat.id,
          targetSenderDisplayName: reply.from?.first_name ?? ctx.chat.title ?? "chat",
          targetText: "text" in reply ? reply.text ?? null : "caption" in reply ? reply.caption ?? null : null,
          targetsHevronia: reply.from?.id === me.id,
        },
        mentionsHevronia: ctx.message.text.includes(`@${me.username}`),
      });
      const turn = await respond({ threadId, message, hevroniaSenderId: me.id });
      const result = await deliverGeneratedTurn(turn, {
        showTyping: async () => {
          await ctx.replyWithChatAction("typing");
        },
        reply: async (text, replyToMessageId) => {
          const delivered = await ctx.reply(text, {
            reply_parameters: { message_id: replyToMessageId },
          });
          return delivered.message_id;
        },
      });
      if (result.status === "silence") {
        console.log(`Observed message=${messageId}; chose silence`);
        return;
      }
      console.log(`Handled message=${messageId}; persistence=${result.persistence}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`Failed to handle message=${messageId}: ${detail}`);
      const fallbackText = "Щось я зараз зависла. Спробуй ще раз за хвилину.";
      const fallbackThreadId = ctx.chat.type === "private"
        ? conversationThreadIdFromTelegramPrivateChat(ctx.chat.id)
        : conversationThreadIdFromTelegramGroupChat(ctx.chat.id);
      await deliverFallbackMessage({ text: fallbackText, senderId: me.id,
        chatKind: ctx.chat.type, replyTo: { targetMessageId: messageId,
          targetSenderId: ctx.from.id,
          targetSenderDisplayName: displayNameFrom(ctx.from.first_name, ctx.from.last_name),
          targetText: ctx.message.text } }, {
        showTyping: async () => undefined,
        reply: async (text, targetMessageId) => (await ctx.reply(text, {
          reply_parameters: { message_id: targetMessageId },
        })).message_id,
      }, (fallback) => recordDeliveredMessage(fallbackThreadId, fallback)).catch(
        (fallbackError) => console.error(`Failed to deliver fallback: ${String(fallbackError)}`),
      );
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

function displayNameFrom(firstName: string, lastName?: string): string {
  return [firstName, lastName].filter(Boolean).join(" ");
}
