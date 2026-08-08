import { HumanMessage, isBaseMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import type { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { summarizationMiddleware } from "langchain";
import type { TokenCounter } from "langchain";

import type { ConversationThreadId } from "./identifiers.js";
import type { CanonicalTelegramEvent } from "./telegram-event.js";
import { serializeTelegramEvent } from "./telegram-event.js";
import { SUMMARY_PREFIX, SUMMARY_PROMPT } from "./summary.js";

export interface ConversationStoreOptions {
  summaryModel: BaseLanguageModel;
  triggerTokens: number;
  keepTokens: number;
  trimTokensToSummarize: number;
  tokenCounter?: TokenCounter;
}

export function createConversationStore(
  checkpointer: SqliteSaver,
  options: ConversationStoreOptions,
) {
  const middleware = summarizationMiddleware({
    model: options.summaryModel,
    trigger: { tokens: options.triggerTokens },
    keep: { tokens: options.keepTokens },
    trimTokensToSummarize: options.trimTokensToSummarize,
    summaryPrefix: SUMMARY_PREFIX,
    summaryPrompt: SUMMARY_PROMPT,
    tokenCounter: options.tokenCounter,
  });
  const graph = new StateGraph(MessagesAnnotation)
    .addNode("compact", async (state) => {
      if (!(middleware.beforeModel instanceof Function)) {
        return {};
      }
      return await middleware.beforeModel(state, { context: { summaryPrompt: SUMMARY_PROMPT } });
    })
    .addEdge(START, "compact")
    .compile({ checkpointer });

  const config = (threadId: ConversationThreadId) => ({
    configurable: { thread_id: threadId.toPersistenceKey() },
  });
  return {
    async append(threadId: ConversationThreadId, event: CanonicalTelegramEvent): Promise<void> {
      await graph.invoke(
        { messages: [new HumanMessage(serializeTelegramEvent(event))] },
        config(threadId),
      );
    },
    async getMessages(threadId: ConversationThreadId): Promise<BaseMessage[]> {
      const snapshot = await graph.getState(config(threadId));
      const stored: unknown = snapshot.values["messages"];
      return Array.isArray(stored) ? stored.filter(isBaseMessage) : [];
    },
  };
}
