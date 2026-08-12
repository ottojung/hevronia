import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ConversationLayer, ConversationLayerOptions } from "./conversation-types.js";
import { createConversationStore } from "./conversation-store.js";
import { GeneratedTurn } from "./generated-turn.js";
import { createNaturalNameStore } from "./natural-names/store.js";
import { PendingConversationWrites } from "./pending-conversation-writes.js";
import { warmParticipant } from "./warm-participant.js";
import { createAttentionPlanner } from "./attention-planner.js";
import { createRealizer } from "./realizer.js";
import { cheapModelFromEnv, createChatModel, smartModelFromEnv } from "./model.js";
import { SYSTEM_PROMPT } from "./personality.js";
import { ReactionCoordinator } from "./reaction-coordinator.js";
import { reactTurn, type ReactTurnDependencies } from "./react-turn.js";
import { observeIncoming } from "./turn-memory.js";
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
  const coordinator = new ReactionCoordinator();
  let layerClosed = false;
  const dependencies: ReactTurnDependencies = { store, planner, realizer, naturalNameStore,
    personality, canonicalWrites, lazyMemory, onPlannerDecision: options.onPlannerDecision,
    onRealizerDecision: options.onRealizerDecision };

  return {
    // Deterministic single reaction for tests and the simulation harness:
    // observe the incoming event, then react synchronously and return the turn.
    respond: async (input) => {
      await observeIncoming(store, canonicalWrites, lazyMemory, input);
      const result = await reactTurn(dependencies, input, undefined, undefined);
      return result.status === "speak" ? result.turn : GeneratedTurn.fromSilence();
    },
    observe: async (input, delivery, onCurrentReactionFailure) => {
      const threadKey = input.threadId.toPersistenceKey();
      const revision = coordinator.invalidate(threadKey);
      await observeIncoming(store, canonicalWrites, lazyMemory, input);
      coordinator.start(threadKey, revision, async (ctx) => {
        await reactTurn(dependencies, input, ctx, delivery);
      }, { onCurrentReactionFailure });
    },
    recordDeliveredMessage: (threadId, message) => {
      canonicalWrites.enqueue(threadId, () => store.append(threadId, message));
    },
    getMessages: async (threadId) => { await canonicalWrites.waitForThread(threadId);
      return store.getMessages(threadId); },
    warmParticipant: (sender) => warmParticipant(lazyMemory, sender),
    settle: () => coordinator.settle(),
    async close(): Promise<void> {
      if (layerClosed) return;
      layerClosed = true;
      await coordinator.abortAllAndSettle();
      await canonicalWrites.drain();
      await lazyMemory?.close();
      await naturalNameStore.close();
      checkpointer.db.close();
    },
  };
}
