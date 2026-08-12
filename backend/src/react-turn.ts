import type { RespondInput } from "./conversation-types.js";
import { toRealizerDecisionLog } from "./decision-log.js";
import { errorDetail } from "./error-detail.js";
import { isReactionCancelledError } from "./reaction-cancelled.js";
import type { ReactionContext } from "./reaction-context.js";
import type { RealizerDecision, TurnContext } from "./realizer-schema.js";
import { finalizeSpeakOrDeliver } from "./finalize-reaction.js";
import { runPlannerGate } from "./planner-gate.js";
import { acquireReactionContext } from "./turn-memory.js";
import type { TelegramTurnDelivery } from "./telegram-delivery.js";
import type { ReactTurnDependencies, ReactTurnResult } from "./react-turn-types.js";

export type { ReactTurnDependencies, ReactTurnResult } from "./react-turn-types.js";

/**
 * Reacts to the latest persisted canonical state for one incoming event:
 * acquire context, run the cheap planner, optionally the smart realizer, and
 * resolve the result. A stale or aborted `ctx` terminates the reaction with a
 * cancellation error instead of failing open; `delivery`, when provided, is
 * performed under the same revision guards.
 */
export async function reactTurn(
  dependencies: ReactTurnDependencies,
  input: RespondInput,
  ctx: ReactionContext | undefined,
  delivery: TelegramTurnDelivery | undefined,
): Promise<ReactTurnResult> {
  const { lazyMemory } = dependencies;
  const memoryTurn = lazyMemory?.beginTurn();
  try {
    const state = await acquireReactionContext(
      dependencies.store, dependencies.canonicalWrites, dependencies.lazyMemory,
      memoryTurn?.snapshot, input, dependencies.naturalNameStore,
    );
    const context: TurnContext = {
      boundedHistory: state.history,
      currentMessage: input.message,
      visibleMessages: state.candidates,
      participantMemories: state.participantMemories,
      naturalNames: state.naturalNames,
    };

    ctx?.throwIfStale();
    const gate = await runPlannerGate(
      dependencies.planner, dependencies.naturalNameStore, context,
      state.namingChoices, input.message.chatKind, input.message.directlyAddressed,
      ctx?.signal, ctx, dependencies.onPlannerDecision,
    );
    if (gate.outcome === "filtered") {
      console.log(`Filtered reaction thread=${ctx?.threadKey ?? "-"} revision=${ctx?.revision ?? 0}`);
      return { status: "filtered" };
    }

    let decision: RealizerDecision;
    try {
      decision = await dependencies.realizer.realize(gate.context, ctx?.signal);
    } catch (error) {
      if (isReactionCancelledError(error)) throw error;
      dependencies.onRealizerDecision?.({ action: "failure", errorDetail: errorDetail(error) });
      throw error;
    }

    ctx?.throwIfStale();
    if (decision.action === "silence") {
      dependencies.onRealizerDecision?.(toRealizerDecisionLog(decision, undefined));
      console.log(`Realizer chose silence thread=${ctx?.threadKey ?? "-"} revision=${ctx?.revision ?? 0}`);
      return { status: "silence" };
    }

    return finalizeSpeakOrDeliver(
      dependencies, input, gate.context, decision, ctx, delivery,
    );
  } finally {
    memoryTurn?.release();
  }
}
