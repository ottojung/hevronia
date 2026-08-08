import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { HumanMessage, isBaseMessage, type BaseMessage } from "@langchain/core/messages";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { SYSTEM_PROMPT } from "./personality.js";
import { DEFAULT_DB_PATH } from "./summary.js";
import { extractReplyText } from "./text.js";
import type {
  ConversationLayer,
  ConversationLayerOptions,
  RespondInput,
} from "./conversation-types.js";
import { recallForTurn, rememberDeliveredUserMessage } from "./long-term-memory/operations.js";
import { PendingMemoryWrites } from "./long-term-memory/pending.js";
import { GeneratedTurn } from "./generated-turn.js";
import {
  createSocialDecisionMaker,
  renderDecisionForRealization,
  renderObservedTranscript,
} from "./social-decision.js";
import { renderTelegramTextEvent } from "./telegram-event.js";
import { createConversationAgent } from "./conversation-agent.js";

export function createConversationLayer(options: ConversationLayerOptions = {}): ConversationLayer {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const systemPrompt = options.systemPrompt ?? SYSTEM_PROMPT;
  const longTermMemory = options.longTermMemory;
  const pendingMemoryWrites = options.pendingMemoryWrites ?? new PendingMemoryWrites();

  mkdirSync(dirname(dbPath), { recursive: true });
  const checkpointer = SqliteSaver.fromConnString(dbPath);
  const { agent, model, triggerTokens, keepTokens, trimTokensToSummarize } =
    createConversationAgent(options, checkpointer, systemPrompt);
  console.log(`Conversation memory initialized; checkpoint database opened: ${dbPath}`);
  console.log(
    `Compaction configuration loaded: trigger=${triggerTokens} tokens, keep=${keepTokens} tokens, trim=${trimTokensToSummarize} tokens`,
  );

  const decisionMaker = options.decisionMaker ?? createSocialDecisionMaker(model);

  return {
    async respond(input: RespondInput): Promise<GeneratedTurn> {
      const { threadId, userId, messageText } = input;
      const recalledMemories = await recallForTurn(longTermMemory, userId, messageText);
      const tuple = await checkpointer.getTuple({ configurable: { thread_id: threadId.toPersistenceKey() } });
      const stored = tuple?.checkpoint.channel_values["messages"];
      const history = Array.isArray(stored) ? stored.filter(isBaseMessage) : [];
      const observedEvent = renderTelegramTextEvent({
        messageId: input.messageId,
        speakerName: input.speakerName,
        text: messageText,
      });
      const invocationConfig = {
        configurable: { thread_id: threadId.toPersistenceKey() },
        context: { recalledMemories },
      };
      const rememberSilence = async (): Promise<GeneratedTurn> => {
        await agent.updateState(invocationConfig, { messages: [new HumanMessage(observedEvent)] });
        return GeneratedTurn.fromSilence(
          () => rememberDeliveredUserMessage(longTermMemory, userId, threadId, messageText),
          pendingMemoryWrites,
        );
      };
      let decision;
      try {
        decision = await decisionMaker.decide(renderObservedTranscript(history, observedEvent));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`Social decision failed safely to silence: ${detail}`);
        return rememberSilence();
      }
      if (decision.action === "silence") {
        return rememberSilence();
      }
      const result = await agent.invoke(
        { messages: [new HumanMessage(renderDecisionForRealization(observedEvent, decision))] },
        invocationConfig,
      );
      const replyText = extractReplyText(result.messages);
      return GeneratedTurn.fromGeneratedResponse(
        replyText,
        decision.replyToMessageId,
        () => rememberDeliveredUserMessage(longTermMemory, userId, threadId, messageText),
        pendingMemoryWrites,
      );
    },
    async getMessages(threadId): Promise<BaseMessage[]> {
      const tuple = await checkpointer.getTuple({ configurable: { thread_id: threadId.toPersistenceKey() } });
      const stored = tuple?.checkpoint.channel_values["messages"];
      if (!Array.isArray(stored)) {
        return [];
      }
      return stored.filter(isBaseMessage);
    },
    async close(): Promise<void> {
      await pendingMemoryWrites.drain();
      checkpointer.db.close();
    },
  };
}
