import { createAgent, summarizationMiddleware } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import type { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

import type { ConversationLayerOptions } from "./conversation-types.js";
import { MODEL, openAiKeyFromEnv } from "./model.js";
import { COMPACTION, SUMMARY_PREFIX, SUMMARY_PROMPT } from "./summary.js";
import {
  invocationContextSchema,
  recalledMemoryPromptMiddleware,
} from "./long-term-memory/context.js";

export function createConversationAgent(
  options: ConversationLayerOptions,
  checkpointer: SqliteSaver,
  systemPrompt: string,
) {
  const model = options.model ?? new ChatOpenAI({ apiKey: openAiKeyFromEnv(), model: MODEL });
  const summaryModel = options.summaryModel ?? new ChatOpenAI({
    apiKey: openAiKeyFromEnv(), model: MODEL, temperature: 0,
  });
  const triggerTokens = options.triggerTokens ?? COMPACTION.triggerTokens;
  const keepTokens = options.keepTokens ?? COMPACTION.keepTokens;
  const trimTokensToSummarize = options.trimTokensToSummarize ?? COMPACTION.trimTokensToSummarize;
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
  return { agent, model, triggerTokens, keepTokens, trimTokensToSummarize };
}
