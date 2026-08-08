import {
  createAgent,
  summarizationMiddleware,
} from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { HumanMessage, isBaseMessage, type BaseMessage } from "@langchain/core/messages";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { MODEL, openAiKeyFromEnv } from "./model.js";
import { SYSTEM_PROMPT } from "./personality.js";
import { COMPACTION, DEFAULT_DB_PATH, SUMMARY_PREFIX, SUMMARY_PROMPT } from "./summary.js";
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
  invocationContextSchema,
  recalledMemoryPromptMiddleware,
} from "./long-term-memory/context.js";

export function createConversationLayer(options: ConversationLayerOptions = {}): ConversationLayer {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const systemPrompt = options.systemPrompt ?? SYSTEM_PROMPT;
  const triggerTokens = options.triggerTokens ?? COMPACTION.triggerTokens;
  const keepTokens = options.keepTokens ?? COMPACTION.keepTokens;
  const trimTokensToSummarize =
    options.trimTokensToSummarize ?? COMPACTION.trimTokensToSummarize;
  const longTermMemory = options.longTermMemory;
  const pendingMemoryWrites = options.pendingMemoryWrites ?? new PendingMemoryWrites();

  mkdirSync(dirname(dbPath), { recursive: true });
  const checkpointer = SqliteSaver.fromConnString(dbPath);
  console.log(`Conversation memory initialized; checkpoint database opened: ${dbPath}`);
  console.log(
    `Compaction configuration loaded: trigger=${triggerTokens} tokens, keep=${keepTokens} tokens, trim=${trimTokensToSummarize} tokens`,
  );

  const model =
    options.model ??
    new ChatOpenAI({
      apiKey: openAiKeyFromEnv(),
      model: MODEL,
    });
  const summaryModel =
    options.summaryModel ??
    new ChatOpenAI({
      apiKey: openAiKeyFromEnv(),
      model: MODEL,
      temperature: 0,
    });

  const agent = createAgent({
    model,
    tools: [],
    contextSchema: invocationContextSchema,
    checkpointer,
    middleware: [
      recalledMemoryPromptMiddleware(systemPrompt),
      summarizationMiddleware({
        model: summaryModel,
        trigger: { tokens: triggerTokens },
        keep: { tokens: keepTokens },
        trimTokensToSummarize,
        summaryPrefix: SUMMARY_PREFIX,
        summaryPrompt: SUMMARY_PROMPT,
        tokenCounter: options.tokenCounter,
      }),
    ],
  });

  return {
    async respond({ threadId, userId, messageText }: RespondInput): Promise<GeneratedTurn> {
      const recalledMemories = await recallForTurn(longTermMemory, userId, messageText);
      const result = await agent.invoke(
        { messages: [new HumanMessage(messageText)] },
        { configurable: { thread_id: threadId.toPersistenceKey() }, context: { recalledMemories } },
      );
      const replyText = extractReplyText(result.messages);
      return GeneratedTurn.fromGeneratedResponse(
        replyText,
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
