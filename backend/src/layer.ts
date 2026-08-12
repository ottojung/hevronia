import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ConversationLayer, ConversationLayerOptions } from "./conversation-types.js";
import { createConversationStore } from "./conversation-store.js";
import { createNaturalNameStore } from "./natural-names/store.js";
import { PendingConversationWrites } from "./pending-conversation-writes.js";
import { respondTurn } from "./respond-turn.js";
import { warmParticipant } from "./warm-participant.js";
import { createAttentionPlanner } from "./attention-planner.js";
import { createRealizer } from "./realizer.js";
import { cheapModelFromEnv, createChatModel, smartModelFromEnv } from "./model.js";
import { SYSTEM_PROMPT } from "./personality.js";
import { COMPACTION, DEFAULT_DB_PATH } from "./summary.js";

/**
 * The natural-name DB for a checkpoint DB: an in-memory DB for `:memory:`
 * checkpoints, otherwise a sibling file next to the checkpoint file, so a
 * harness scenario's temporary checkpoint directory also owns its notebook.
 */
function naturalNamesDbPathFor(checkpointDbPath: string): string {
  if (checkpointDbPath === ":memory:") return ":memory:";
  return join(dirname(checkpointDbPath), "natural-names.sqlite");
}

export function createConversationLayer(options: ConversationLayerOptions = {}): ConversationLayer {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const personality = options.systemPrompt ?? SYSTEM_PROMPT;
  const lazyMemory = options.lazyMemory;
  mkdirSync(dirname(dbPath), { recursive: true });
  const checkpointer = SqliteSaver.fromConnString(dbPath);
  // Default chat models are built only when the corresponding component is
  // actually created, so a fully stubbed layer (planner, realizer, and
  // summaryModel supplied) never touches a provider key.
  const store = options.conversationStore ?? createConversationStore(checkpointer, {
    summaryModel: options.summaryModel
      ?? createChatModel(smartModelFromEnv(), { temperature: 0 }),
    triggerTokens: options.triggerTokens ?? COMPACTION.triggerTokens,
    keepTokens: options.keepTokens ?? COMPACTION.keepTokens,
    trimTokensToSummarize: options.trimTokensToSummarize ?? COMPACTION.trimTokensToSummarize,
    tokenCounter: options.tokenCounter,
  });
  const planner = options.planner ?? createAttentionPlanner(
    options.plannerModel
      ?? createChatModel(cheapModelFromEnv(), { lowThinking: true, temperature: 0 }),
  );
  const realizer = options.realizer ?? createRealizer(
    options.realizerModel ?? createChatModel(smartModelFromEnv()),
    personality,
  );
  const canonicalWrites = options.pendingConversationWrites ?? new PendingConversationWrites();
  const naturalNameStore = options.naturalNameStore
    ?? createNaturalNameStore(
      options.naturalNameDbPath ?? naturalNamesDbPathFor(dbPath),
    );
  const respondDependencies = { store, planner, realizer, naturalNameStore, personality,
    canonicalWrites, lazyMemory, onPlannerDecision: options.onPlannerDecision,
    onRealizerDecision: options.onRealizerDecision };

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
      await naturalNameStore.close();
      checkpointer.db.close();
    },
  };
}
