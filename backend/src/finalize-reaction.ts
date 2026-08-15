import type { RespondInput } from "./conversation-types.js";
import { toRealizerDecisionLog } from "./decision-log.js";
import { errorDetail } from "./error-detail.js";
import { GeneratedTurn } from "./generated-turn.js";
import type { ReactionContext } from "./reaction-context.js";
import type { RealizerDecision, TurnContext } from "./realizer-schema.js";
import type { ReactTurnDependencies, ReactTurnResult } from "./react-turn-types.js";
import {
  deliverGeneratedTurn,
  type DeliveryCommit,
  type TelegramTurnDelivery,
} from "./telegram-delivery.js";
import {
  UnresolvableRealizerDecisionError,
  deliveredEvent,
  replyRelationshipFor,
  resolveRealizerDecision,
} from "./speak-resolution.js";

/**
 * Resolves a realizer speak decision into a turn and, when a delivery is
 * provided, sends it under the reaction's revision guards. Delivery becomes
 * committed at the moment the Telegram send begins: a confirmed send is always
 * persisted even if a newer event arrived while the network request was in
 * flight, and the replacement reaction waits for that reconciliation.
 */
export async function finalizeSpeakOrDeliver(
  dependencies: ReactTurnDependencies,
  input: RespondInput,
  context: TurnContext,
  decision: RealizerDecision,
  ctx: ReactionContext | undefined,
  delivery: TelegramTurnDelivery | undefined,
): Promise<ReactTurnResult> {
  if (decision.action !== "speak" || decision.message === null) {
    return { status: "silence" };
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
    return { status: "silence" };
  }

  dependencies.onRealizerDecision?.(toRealizerDecisionLog(decision, resolved));
  const replyTo = replyRelationshipFor(resolved.replyTo);
  const turn = GeneratedTurn.fromSpeak(decision.message, replyTo, (messageId) => {
    const delivered = deliveredEvent(
      messageId, input.hevroniaSender, decision.message, input.message, replyTo,
    );
    dependencies.canonicalWrites.enqueue(
      input.threadId, () => dependencies.store.append(input.threadId, delivered),
    );
  });

  ctx?.throwIfStale();
  if (delivery === undefined) {
    return { status: "speak", turn };
  }
  await deliverGeneratedTurn(
    turn, delivery, () => ctx?.throwIfStale(), commitHook(ctx),
  );
  console.log(`Confirmed delivery thread=${ctx?.threadKey ?? "-"} revision=${ctx?.revision ?? 0}`);
  return { status: "delivered" };
}

function commitHook(ctx: ReactionContext | undefined): DeliveryCommit | undefined {
  if (ctx === undefined) return undefined;
  let complete: (() => void) | undefined;
  return {
    begin: () => {
      complete = ctx.beginCommittedDelivery().complete;
    },
    complete: () => complete?.(),
  };
}
