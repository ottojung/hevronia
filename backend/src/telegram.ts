import { Bot } from "grammy";

import { conversationThreadIdFromTelegramChat } from "./identifiers.js";
import { installMembershipWarmup } from "./telegram-membership.js";
import { logBotIdentity, tokenFromEnv } from "./telegram-config.js";
import { createObservedTelegramMessage, hasDirectMention, telegramDisplayName, telegramSenderIdentity } from "./telegram-observation.js";
import { installTelegramRetry } from "./telegram-retry.js";
import { isConversationThreadPersistenceError } from "./pending-conversation-writes.js";
import { getConversationLayer } from "./memory.js";

export async function startBot(): Promise<void> {
  const bot = new Bot(tokenFromEnv());

  installTelegramRetry(bot);

  const me = await bot.api.getMe();
  logBotIdentity(me);

  installMembershipWarmup(bot);

  bot.on("message:text", async (ctx) => {
    const sendReply = async (text: string, replyToMessageId: number | null): Promise<number> =>
      (await ctx.reply(text, replyToMessageId === null
        ? undefined
        : { reply_parameters: { message_id: replyToMessageId } })).message_id;
    const updateId = ctx.update.update_id;
    const messageId = ctx.message.message_id;
    const messageThreadId = ctx.message.message_thread_id;
    console.log(`Handling Telegram text message update=${updateId} message=${messageId}`);
    try {
      const threadId = conversationThreadIdFromTelegramChat(ctx.chat.type, ctx.chat.id, messageThreadId);
      const reply = ctx.message.reply_to_message;
      const sender = telegramSenderIdentity(ctx.from.id, ctx.message.sender_chat?.id);
      const displayName = ctx.message.sender_chat?.title ??
        telegramDisplayName(ctx.from.first_name, ctx.from.last_name);
      const message = createObservedTelegramMessage({
        messageId, sender, senderDisplayName: displayName,
        senderUsername: ctx.message.from?.username ?? null,
        messageThreadId: messageThreadId ?? null,
        chatKind: ctx.chat.type, text: ctx.message.text,
        replyTo: reply === undefined ? null : {
          targetMessageId: reply.message_id,
          targetSender: telegramSenderIdentity(
            reply.from?.id ?? ctx.from.id, reply.sender_chat?.id,
          ),
          targetSenderDisplayName: reply.sender_chat?.title ?? reply.from?.first_name ?? "unknown",
          targetSenderUsername: reply.from?.username ?? null,
          targetText: "text" in reply ? reply.text ?? null : "caption" in reply ? reply.caption ?? null : null,
          targetsHevronia: reply.from?.id === me.id,
        },
        mentionsHevronia: hasDirectMention(ctx.message.text, ctx.message.entities, me.id, me.username),
      });
      // Observe and react asynchronously: the handler returns after canonical
      // persistence while the reaction continues detached under per-thread
      // cancellation. Errors never produce Telegram dialogue — silence is the
      // only acceptable visible result of a failure.
      await getConversationLayer().observe({ threadId, message,
        hevroniaSender: { kind: "user", id: me.id },
        senderIsBot: ctx.from.is_bot }, {
        showTyping: async () => { await ctx.replyWithChatAction("typing"); },
        reply: sendReply,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`Failed to handle message=${messageId}: ${detail}`);
      if (isConversationThreadPersistenceError(error)) return;
    }
  });

  bot.catch((error) => {
    const detail = error.error instanceof Error ? error.error.message : String(error.error);
    console.error(`Error while processing update=${error.ctx.update.update_id}: ${detail}`);
  });

  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`Received ${signal}; stopping long polling...`);
    await bot.stop();
    console.log("Stopped cleanly.");
  };
  process.once("SIGINT", () => void stop("SIGINT")); process.once("SIGTERM", () => void stop("SIGTERM"));

  console.log("Starting long polling...");
  await bot.start({
    allowed_updates: ["message", "my_chat_member", "chat_member"],
    onStart: (botInfo) => { console.log(`Long polling started; listening as @${botInfo.username}`); },
  });
  console.log("Long polling stopped.");
}
