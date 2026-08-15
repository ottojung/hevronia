import type { ResolvedRealizerDecision } from "./speak-resolution.js";
import type { RealizerDecision } from "./realizer-schema.js";
import type { RealizerDecisionLog } from "./realizer.js";

export function toRealizerDecisionLog(
  decision: RealizerDecision,
  resolved: ResolvedRealizerDecision | undefined,
): RealizerDecisionLog {
  const common = {
    interpretation: decision.interpretation,
    presentMind: decision.presentMind,
    characterIntent: decision.characterIntent,
    realityCheck: decision.realityCheck,
    dreamIntent: decision.dreamIntent,
    feltState: decision.feltState,
    activeDesire: decision.activeDesire,
    desiredOutcome: decision.desiredOutcome,
    opportunity: decision.opportunity,
    fiveTurnStrategy: decision.fiveTurnStrategy,
    fiftyTurnStrategy: decision.fiftyTurnStrategy,
  };
  if (decision.action === "silence") {
    return { action: "silence", ...common };
  }
  return {
    action: "speak",
    addressLabel: resolved?.address?.character.subject ?? null,
    replyToLabel: resolved?.replyTo === undefined || resolved.replyTo === null
      ? null
      : `${resolved.replyTo.handle} → ${resolved.replyTo.message.senderDisplayName}`,
    ...common,
  };
}
