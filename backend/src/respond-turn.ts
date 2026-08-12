import type { ConversationStore } from "./conversation-store.js";
import type { RespondInput } from "./conversation-types.js";
import type {
  AttentionPlanner,
  PlannerDecision,
  PlannerDecisionLog,
} from "./attention-planner.js";
import { errorDetail } from "./error-detail.js";
import { GeneratedTurn } from "./generated-turn.js";
import type { LazyLongTermMemory } from "./long-term-memory/runtime.js";
import { applyProposedNames } from "./natural-names/apply.js";
import type { NaturalNameStore } from "./natural-names/store.js";
import { PendingConversationWrites } from "./pending-conversation-writes.js";
import type { Realizer, RealizerDecisionLog } from "./realizer.js";
import type { TurnContext } from "./realizer-schema.js";
import { finalizeTurn } from "./finalize-turn.js";
import { acquireTurnContext } from "./turn-memory.js";

export interface RespondTurnDependencies {
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

export async function respondTurn(
  dependencies: RespondTurnDependencies,
  input: RespondInput,
): Promise<GeneratedTurn> {
  const { lazyMemory } = dependencies;
  const memoryTurn = lazyMemory?.beginTurn();
  try {
    const memory = await acquireTurnContext(
      dependencies.store, dependencies.canonicalWrites, lazyMemory,
      memoryTurn?.snapshot, input, dependencies.naturalNameStore,
    );
    const context: TurnContext = {
      boundedHistory: memory.history,
      currentMessage: input.message,
      visibleMessages: memory.candidates,
      participantMemories: memory.participantMemories,
      naturalNames: memory.naturalNames,
    };

    let plannerDecision: PlannerDecision = { attention: true, naturalNames: {} };
    let plannerFailed = false;
    try {
      plannerDecision = await dependencies.planner.consider(
        context, memory.namingChoices,
      );
    } catch (error) {
      plannerFailed = true;
      dependencies.onPlannerDecision?.({ outcome: "failure", errorDetail: errorDetail(error) });
      // Fail open: a failed attention pre-filter must never create an
      // irreversible false negative, so continue to the smart realizer. No
      // name is persisted from a failed planner.
    }

    const applied = await applyProposedNames(
      dependencies.naturalNameStore, memory.namingChoices,
      plannerDecision.naturalNames, memory.naturalNames,
    );
    context.naturalNames = applied.merged;

    if (!plannerFailed) {
      const canFilter = !(input.message.chatKind === "private"
        || input.message.directlyAddressed);
      if (!plannerDecision.attention && canFilter) {
        dependencies.onPlannerDecision?.({
          outcome: "filter", attention: false,
          naturalNames: applied.newNames,
        });
        return GeneratedTurn.fromSilence();
      }
      dependencies.onPlannerDecision?.({
        outcome: "pass", attention: plannerDecision.attention,
        naturalNames: applied.newNames,
      });
    }

    return finalizeTurn(dependencies, input, context);
  } finally {
    memoryTurn?.release();
  }
}
