import type { AttentionPlanner, PlannerDecision, PlannerDecisionLog } from "./attention-planner.js";
import { errorDetail } from "./error-detail.js";
import { applyProposedNames } from "./natural-names/apply.js";
import type { NaturalNameStore } from "./natural-names/store.js";
import type { MissingNaturalNameChoice } from "./planner-schema.js";
import { isReactionCancelledError } from "./reaction-cancelled.js";
import type { ReactionContext } from "./reaction-context.js";
import type { TurnContext } from "./realizer-schema.js";

export interface PlannerGateOutcome {
  context: TurnContext;
  plannerFailed: boolean;
  newNames: Record<string, string>;
}

export type PlannerGateResult =
  | { outcome: "filtered"; context: TurnContext; plannerFailed: false; newNames: Record<string, string> }
  | { outcome: "continue"; context: TurnContext; plannerFailed: boolean; newNames: Record<string, string> };

/**
 * Runs the cheap planner, applies its naming proposals under a staleness guard
 * (so an obsolete planner can never begin durable natural-name writes), and
 * decides whether the ordinary event should be filtered. Planner failures fail
 * open; a cancelled planner never fails open.
 */
export async function runPlannerGate(
  planner: AttentionPlanner,
  naturalNameStore: NaturalNameStore,
  context: TurnContext,
  namingChoices: readonly MissingNaturalNameChoice[],
  inputChatKind: "private" | "group" | "supergroup",
  inputDirectlyAddressed: boolean,
  signal: AbortSignal | undefined,
  ctx: ReactionContext | undefined,
  onPlannerDecision: ((log: PlannerDecisionLog) => void) | undefined,
): Promise<PlannerGateResult> {
  let plannerDecision: PlannerDecision = { attention: true, naturalNames: {} };
  let plannerFailed = false;
  try {
    plannerDecision = await planner.consider(context, namingChoices, signal);
  } catch (error) {
    if (isReactionCancelledError(error)) throw error;
    plannerFailed = true;
    onPlannerDecision?.({ outcome: "failure", errorDetail: errorDetail(error) });
    // Fail open: a genuine attention pre-filter failure must never create an
    // irreversible false negative, so continue to the smart realizer.
  }

  // A stale planner result must never mutate durable first-write-wins natural
  // names, and the mutation step re-checks before every write.
  ctx?.throwIfStale();
  const applied = await applyProposedNames(
    naturalNameStore, namingChoices, plannerDecision.naturalNames,
    context.naturalNames, () => ctx?.throwIfStale(),
  );
  context.naturalNames = applied.merged;
  ctx?.throwIfStale();

  if (!plannerFailed) {
    const canFilter = !(inputChatKind === "private" || inputDirectlyAddressed);
    if (!plannerDecision.attention && canFilter) {
      onPlannerDecision?.({
        outcome: "filter", attention: false, naturalNames: applied.newNames,
      });
      return { outcome: "filtered", context, plannerFailed: false, newNames: applied.newNames };
    }
    onPlannerDecision?.({
      outcome: "pass", attention: plannerDecision.attention, naturalNames: applied.newNames,
    });
  }
  return { outcome: "continue", context, plannerFailed, newNames: applied.newNames };
}
