import { createAgent, summarizationMiddleware, type TokenCounter } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { HumanMessage, isBaseMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { MODEL, openAiKeyFromEnv } from "./model.js";
import { SYSTEM_PROMPT } from "./personality.js";
import { COMPACTION, DEFAULT_DB_PATH, SUMMARY_PREFIX, SUMMARY_PROMPT } from "./summary.js";
import { extractReplyText } from "./text.js";

export interface ConversationLayerOptions {
  dbPath?: string;
  model?: BaseLanguageModel;
  summaryModel?: BaseLanguageModel;
  systemPrompt?: string;
  triggerTokens?: number;
  keepTokens?: number;
  trimTokensToSummarize?: number;
  tokenCounter?: TokenCounter;
}

export interface ConversationLayer {
  respond(threadId: string, messageText: string): Promise<string>;
  getMessages(threadId: string): Promise<BaseMessage[]>;
  close(): Promise<void>;
}

export function createConversationLayer(options: ConversationLayerOptions = {}): ConversationLayer {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const systemPrompt = options.systemPrompt ?? SYSTEM_PROMPT;
  const triggerTokens = options.triggerTokens ?? COMPACTION.triggerTokens;
  const keepTokens = options.keepTokens ?? COMPACTION.keepTokens;
  const trimTokensToSummarize =
    options.trimTokensToSummarize ?? COMPACTION.trimTokensToSummarize;

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
      temperature: 0.9,
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
    systemPrompt,
    checkpointer,
    middleware: [
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
    async respond(threadId: string, messageText: string): Promise<string> {
      const result = await agent.invoke(
        { messages: [new HumanMessage(messageText)] },
        { configurable: { thread_id: threadId } },
      );
      return extractReplyText(result.messages);
    },
    async getMessages(threadId: string): Promise<BaseMessage[]> {
      const tuple = await checkpointer.getTuple({ configurable: { thread_id: threadId } });
      const stored = tuple?.checkpoint.channel_values["messages"];
      if (!Array.isArray(stored)) {
        return [];
      }
      return stored.filter(isBaseMessage);
    },
    async close(): Promise<void> {
      checkpointer.db.close();
    },
  };
}
