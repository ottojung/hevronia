import { HumanMessage, isBaseMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import type { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { countTokensApproximately, type TokenCounter } from "langchain";

import { compactIfNeeded } from "./conversation-compaction.js";
import type { ConversationThreadId } from "./identifiers.js";
import type { CanonicalTelegramEvent } from "./telegram-event.js";
import { serializeTelegramEvent } from "./telegram-event.js";

export interface ConversationStoreOptions {
  summaryModel: BaseLanguageModel;
  triggerTokens: number;
  keepTokens: number;
  trimTokensToSummarize: number;
  tokenCounter?: TokenCounter;
}

export interface ConversationStore {
  append(threadId: ConversationThreadId, event: CanonicalTelegramEvent): Promise<void>;
  getMessages(threadId: ConversationThreadId): Promise<BaseMessage[]>;
}

export function createConversationStore(
  checkpointer: SqliteSaver,
  options: ConversationStoreOptions,
): ConversationStore {
  const tokenCounter = options.tokenCounter ?? countTokensApproximately;
  const graph = new StateGraph(MessagesAnnotation)
    .addNode("compact", async (state) => compactIfNeeded(
      state, options.summaryModel, options.triggerTokens, options.keepTokens,
      options.trimTokensToSummarize, tokenCounter,
    ))
    .addEdge(START, "compact")
    .compile({ checkpointer });

  const config = (threadId: ConversationThreadId) => ({
    configurable: { thread_id: threadId.toPersistenceKey() },
  });
  return {
    async append(threadId: ConversationThreadId, event: CanonicalTelegramEvent): Promise<void> {
      await graph.invoke(
        { messages: [new HumanMessage({ content: serializeTelegramEvent(event),
          id: `${event.kind}:${event.messageId}` })] },
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
