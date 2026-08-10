import { ChatOpenAI } from "@langchain/openai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { ConversationLayer, ConversationLayerOptions } from "./conversation-types.js";
import { createConversationStore } from "./conversation-store.js";
import { PendingConversationWrites } from "./pending-conversation-writes.js";
import { respondTurn } from "./respond-turn.js";
import { warmParticipant } from "./warm-participant.js";
import { modelFromEnv, openAiKeyFromEnv } from "./model.js";
import { SYSTEM_PROMPT } from "./personality.js";
import { createSocialDecisionMaker } from "./social-decision.js";
import { COMPACTION, DEFAULT_DB_PATH } from "./summary.js";

export function createConversationLayer(options: ConversationLayerOptions = {}): ConversationLayer {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const personality = options.systemPrompt ?? SYSTEM_PROMPT;
  const lazyMemory = options.lazyMemory;
  mkdirSync(dirname(dbPath), { recursive: true });
  const checkpointer = SqliteSaver.fromConnString(dbPath);
  const model = options.model ?? new ChatOpenAI({ apiKey: openAiKeyFromEnv(), model: modelFromEnv() });
  const summaryModel = options.summaryModel ?? new ChatOpenAI({ apiKey: openAiKeyFromEnv(),
    model: modelFromEnv(), temperature: 0 });
  const store = options.conversationStore ?? createConversationStore(checkpointer, {
    summaryModel,
    triggerTokens: options.triggerTokens ?? COMPACTION.triggerTokens,
    keepTokens: options.keepTokens ?? COMPACTION.keepTokens,
    trimTokensToSummarize: options.trimTokensToSummarize ?? COMPACTION.trimTokensToSummarize,
    tokenCounter: options.tokenCounter,
  });
  const planner = options.decisionMaker ?? createSocialDecisionMaker(model, personality);
  const canonicalWrites = options.pendingConversationWrites ?? new PendingConversationWrites();
  const respondDependencies = { store, planner, model, personality, canonicalWrites,
    lazyMemory, onSocialDecision: options.onSocialDecision };

  return {
    respond: (input) => respondTurn(respondDependencies, input),
    recordDeliveredMessage: (threadId, message) => {
      canonicalWrites.enqueue(threadId, () => store.append(threadId, message));
    },
    getMessages: async (threadId) => { await canonicalWrites.waitForThread(threadId);
      return store.getMessages(threadId); },
    warmParticipant: (sender) => warmParticipant(lazyMemory, sender),
    async close(): Promise<void> {
      await canonicalWrites.drain();
      await lazyMemory?.close();
      checkpointer.db.close();
    },
  };
}
