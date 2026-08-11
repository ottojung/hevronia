import type { ConversationStore } from "./conversation-store.js";
import type { RespondInput } from "./conversation-types.js";
import type { AttentionPlanner, PlannerDecisionLog } from "./attention-planner.js";
import { toRealizerDecisionLog } from "./decision-log.js";
import { errorDetail } from "./error-detail.js";
import { GeneratedTurn } from "./generated-turn.js";
import type { LazyLongTermMemory } from "./long-term-memory/runtime.js";
import { PendingConversationWrites } from "./pending-conversation-writes.js";
import type { Realizer, RealizerDecisionLog } from "./realizer.js";
import type { RealizerDecision, TurnContext } from "./realizer-schema.js";
import {
  UnresolvableRealizerDecisionError,
  deliveredEvent,
  replyRelationshipFor,
  resolveRealizerDecision,
} from "./speak-resolution.js";
import { acquireTurnContext } from "./turn-memory.js";

export interface RespondTurnDependencies {
  store: ConversationStore;
  planner: AttentionPlanner;
  realizer: Realizer;
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
      memoryTurn?.snapshot, input,
    );
    const context: TurnContext = {
      boundedHistory: memory.history,
      currentMessage: input.message,
      visibleMessages: memory.candidates,
      participantMemories: memory.participantMemories,
    };

    let plannerPassed = true;
    let plannerFailed = false;
    try {
      plannerPassed = await dependencies.planner.consider(context);
    } catch (error) {
      plannerFailed = true;
      dependencies.onPlannerDecision?.({ outcome: "failure", errorDetail: errorDetail(error) });
      // Fail open: a failed attention pre-filter must never create an
      // irreversible false negative, so continue to the smart realizer.
    }
    if (!plannerFailed) {
      if (plannerPassed) {
        dependencies.onPlannerDecision?.({ outcome: "pass" });
      } else {
        dependencies.onPlannerDecision?.({ outcome: "filter" });
        return GeneratedTurn.fromSilence();
      }
    }

    let decision: RealizerDecision;
    try {
      decision = await dependencies.realizer.realize(context);
    } catch (error) {
      dependencies.onRealizerDecision?.({ action: "failure", errorDetail: errorDetail(error) });
      throw error;
    }

    if (decision.action === "silence") {
      dependencies.onRealizerDecision?.(toRealizerDecisionLog(decision, undefined));
      return GeneratedTurn.fromSilence();
    }

    const resolved = resolveRealizerDecision(decision, context.visibleMessages);
    if (resolved === undefined) {
      dependencies.onRealizerDecision?.({
        action: "failure",
        errorDetail: errorDetail(new UnresolvableRealizerDecisionError(
          decision.addressCharacter, decision.replyToMessage,
        )),
      });
      return GeneratedTurn.fromSilence();
    }

    dependencies.onRealizerDecision?.(toRealizerDecisionLog(decision, resolved));
    const replyTo = replyRelationshipFor(resolved.replyTo);
    return GeneratedTurn.fromSpeak(decision.message, replyTo, (messageId) => {
      const delivered = deliveredEvent(
        messageId, input.hevroniaSender, decision.message, input.message, replyTo,
      );
      dependencies.canonicalWrites.enqueue(
        input.threadId, () => dependencies.store.append(input.threadId, delivered),
      );
    });
  } finally {
    memoryTurn?.release();
  }
}
