import { errorDetail } from "./error-detail.js";
import { GeneratedTurn } from "./generated-turn.js";
import type { Realizer } from "./realizer.js";
import type { RealizerDecision, TurnContext } from "./realizer-schema.js";
import type { RespondInput } from "./conversation-types.js";
import type { RespondTurnDependencies } from "./respond-turn.js";
import { toRealizerDecisionLog } from "./decision-log.js";
import {
  UnresolvableRealizerDecisionError,
  deliveredEvent,
  replyRelationshipFor,
  resolveRealizerDecision,
} from "./speak-resolution.js";

/**
 * Runs the smart realizer and turns its decision into a `GeneratedTurn`,
 * including the canonical delivery write when it speaks.
 */
export async function finalizeTurn(
  dependencies: Pick<RespondTurnDependencies, "realizer" | "canonicalWrites" | "store"
    | "onRealizerDecision">,
  input: RespondInput,
  context: TurnContext,
): Promise<GeneratedTurn> {
  const realizer: Realizer = dependencies.realizer;
  let decision: RealizerDecision;
  try {
    decision = await realizer.realize(context);
  } catch (error) {
    dependencies.onRealizerDecision?.({ action: "failure", errorDetail: errorDetail(error) });
    throw error;
  }

  if (decision.action === "silence") {
    dependencies.onRealizerDecision?.(toRealizerDecisionLog(decision, undefined));
    return GeneratedTurn.fromSilence();
  }

  const resolved = resolveRealizerDecision(
    decision, context.visibleMessages, context.naturalNames,
  );
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
}
