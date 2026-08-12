import type { BaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { TokenCounter } from "langchain";

import type { LazyLongTermMemory } from "./long-term-memory/runtime.js";
import type { GeneratedTurn } from "./generated-turn.js";
import type { ConversationThreadId } from "./identifiers.js";
import type { DeliveredHevroniaMessage, ObservedTelegramMessage, TelegramSenderIdentity } from "./telegram-event.js";
import type { AttentionPlanner, PlannerDecisionLog } from "./attention-planner.js";
import type { Realizer, RealizerDecisionLog } from "./realizer.js";

export interface RespondInput {
  threadId: ConversationThreadId;
  message: ObservedTelegramMessage;
  hevroniaSender: TelegramSenderIdentity;
  senderIsBot: boolean;
}

export interface ConversationLayerOptions {
  dbPath?: string;
  plannerModel?: BaseLanguageModel;
  realizerModel?: BaseLanguageModel;
  summaryModel?: BaseLanguageModel;
  systemPrompt?: string;
  triggerTokens?: number;
  keepTokens?: number;
  trimTokensToSummarize?: number;
  tokenCounter?: TokenCounter;
  lazyMemory?: LazyLongTermMemory;
  planner?: AttentionPlanner;
  realizer?: Realizer;
  onPlannerDecision?: (log: PlannerDecisionLog) => void;
  onRealizerDecision?: (log: RealizerDecisionLog) => void;
  conversationStore?: import("./conversation-store.js").ConversationStore;
  pendingConversationWrites?: import("./pending-conversation-writes.js").PendingConversationWrites;
  /** SQLite path for the natural-name notebook; derived as a sibling of dbPath when unset. */
  naturalNameDbPath?: string;
  naturalNameStore?: import("./natural-names/store.js").NaturalNameStore;
}

export interface ConversationLayer {
  /** Deterministic single reaction: observe + react, returning the generated turn. */
  respond(input: RespondInput): Promise<GeneratedTurn>;
  /** Production path: invalidate older reactions, persist, and react detached with delivery. */
  observe(
    input: RespondInput,
    delivery: import("./telegram-delivery.js").TelegramTurnDelivery,
    onCurrentReactionFailure?: import("./reaction-coordinator.js").ReactionFailureHandler,
  ): Promise<void>;
  recordDeliveredMessage(
    threadId: ConversationThreadId,
    message: DeliveredHevroniaMessage,
  ): void;
  getMessages(threadId: ConversationThreadId): Promise<BaseMessage[]>;
  warmParticipant(sender: TelegramSenderIdentity): void;
  /** Waits for all active reactions to settle (test/harness aid). */
  settle(): Promise<void>;
  close(): Promise<void>;
}
