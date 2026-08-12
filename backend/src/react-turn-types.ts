import type { ConversationStore } from "./conversation-store.js";
import type { AttentionPlanner, PlannerDecisionLog } from "./attention-planner.js";
import type { LazyLongTermMemory } from "./long-term-memory/runtime.js";
import type { NaturalNameStore } from "./natural-names/store.js";
import type { PendingConversationWrites } from "./pending-conversation-writes.js";
import type { Realizer, RealizerDecisionLog } from "./realizer.js";
import type { GeneratedTurn } from "./generated-turn.js";

export interface ReactTurnDependencies {
  store: ConversationStore;
  planner: AttentionPlanner;
  realizer: Realizer;
  naturalNameStore: NaturalNameStore;
  personality: string;
  canonicalWrites: PendingConversationWrites;
  lazyMemory?: LazyLongTermMemory;
  onPlannerDecision?: (log: PlannerDecisionLog) => void;
  onRealizerDecision?: (log: RealizerDecisionLog) => void;
}

export type ReactTurnResult =
  | { status: "filtered" | "silence" }
  | { status: "speak"; turn: GeneratedTurn }
  | { status: "delivered" };
