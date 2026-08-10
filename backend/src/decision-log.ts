import { notebookSubject } from "./telegram-event.js";
import type { SocialDecision, SocialDecisionLog, SpeakDecision } from "./social-decision.js";

export function toSpeakLog(speak: SpeakDecision): SocialDecisionLog {
  return {
    action: "speak",
    addressName: speak.address?.character.subject ?? null,
    replyToName: speak.replyTo === null ? null : notebookSubject(speak.replyTo.message.sender),
    ...speak.subjective,
  };
}

export function toSilenceLog(decision: Extract<SocialDecision, { action: "silence" }>): SocialDecisionLog {
  return {
    action: "silence",
    interpretation: decision.interpretation,
    feltState: decision.feltState,
    activeDesire: decision.activeDesire,
    desiredOutcome: decision.desiredOutcome,
    opportunity: decision.opportunity,
    pursuit: decision.pursuit,
  };
}
