import type { Bot } from "grammy";
import { chatMemberFilter, myChatMemberFilter } from "@grammyjs/chat-members";

import { warmParticipant } from "./respond.js";

export function installMembershipWarmup(bot: Bot): void {
  const groups = bot.chatType(["group", "supergroup"]);

  groups.filter(myChatMemberFilter("out", "in"), (ctx) => {
    const actor = ctx.myChatMember.from;
    if (actor !== undefined && !actor.is_bot) {
      warmParticipant({ kind: "user", id: actor.id });
    }
  });

  groups.filter(chatMemberFilter("out", "in"), (ctx) => {
    const member = ctx.chatMember.new_chat_member.user;
    if (member !== undefined && !member.is_bot) {
      warmParticipant({ kind: "user", id: member.id });
    }
  });

  bot.on("message:new_chat_members", (ctx) => {
    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        warmParticipant({ kind: "user", id: member.id });
      }
    }
  });
}
