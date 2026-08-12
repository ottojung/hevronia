import type { ConversationStore } from "./conversation-store.js";
import type { RespondInput } from "./conversation-types.js";
import type {
  AttentionPlanner,
  MissingNaturalNameChoice,
  PlannerDecision,
  PlannerDecisionLog,
} from "./attention-planner.js";
import { toRealizerDecisionLog } from "./decision-log.js";
import { errorDetail } from "./error-detail.js";
import { GeneratedTurn } from "./generated-turn.js";
import type { LazyLongTermMemory } from "./long-term-memory/runtime.js";
import type { NaturalNameStore } from "./natural-names/store.js";
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
  naturalNameStore: NaturalNameStore;
  personality: string;
  canonicalWrites: PendingConversationWrites;
  lazyMemory?: LazyLongTermMemory;
  onPlannerDecision?: (log: PlannerDecisionLog) => void;
  onRealizerDecision?: (log: RealizerDecisionLog) => void;
}

/**
 * Persists every proposed natural name with first-write-wins semantics and
 * returns the merged name map the realizer should see, including any name a
 * concurrent proposal stored first.
 */
async function persistProposedNames(
  store: NaturalNameStore,
  choices: readonly MissingNaturalNameChoice[],
  proposed: Readonly<Record<string, string>>,
  existing: ReadonlyMap<number, string>,
): Promise<ReadonlyMap<number, string>> {
  const merged = new Map(existing);
  for (const choice of choices) {
    const name = proposed[choice.handle];
    if (name === undefined) continue;
    merged.set(choice.sender.id, await store.assignIfAbsent(choice.sender.id, name));
  }
  return merged;
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

    context.naturalNames = await persistProposedNames(
      dependencies.naturalNameStore, memory.namingChoices,
      plannerDecision.naturalNames, memory.naturalNames,
    );

    if (!plannerFailed) {
      const canFilter = !(input.message.chatKind === "private"
        || input.message.directlyAddressed);
      if (!plannerDecision.attention && canFilter) {
        dependencies.onPlannerDecision?.({
          outcome: "filter", attention: false,
          naturalNames: plannerDecision.naturalNames,
        });
        return GeneratedTurn.fromSilence();
      }
      dependencies.onPlannerDecision?.({
        outcome: "pass", attention: plannerDecision.attention,
        naturalNames: plannerDecision.naturalNames,
      });
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
