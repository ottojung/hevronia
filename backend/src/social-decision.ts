import type { AddressChoice, ReplyMessageChoice } from "./reply-choices.js";

export { PLANNING_MODE, createSocialDecisionMaker, renderDecisionContext } from "./planner.js";
export {
  socialDecisionResponseSchema,
  socialDecisionSchema,
  type SocialDecision,
  type SocialDecisionContext,
  type SocialDecisionMaker,
  type VisibleMessage,
} from "./social-decision-schema.js";

/**
 * The six subjective fields, each a complete natural second-person sentence
 * that will be concatenated verbatim into Хевронія's realization context.
 */
export interface SubjectiveState {
  interpretation: string;
  feltState: string;
  activeDesire: string;
  desiredOutcome: string;
  opportunity: string;
  pursuit: string;
}

export function subjectiveParagraph(state: SubjectiveState): string {
  return [
    state.interpretation,
    state.feltState,
    state.activeDesire,
    state.desiredOutcome,
    state.opportunity,
    state.pursuit,
  ].join(" ");
}

/**
 * A resolved speaking decision: the independently chosen social addressee and
 * optional Telegram reply attachment, plus the final subjective paragraph.
 * The subjective fields are what the realizer inhabits; address and replyTo
 * are delivery metadata.
 */
export interface SpeakDecision {
  address: AddressChoice | null;
  replyTo: ReplyMessageChoice | null;
  subjective: SubjectiveState;
}

export type SocialDecisionLog =
  | { action: "silence" }
  | {
      action: "silence";
      interpretation: string;
      feltState: string;
      activeDesire: string;
      desiredOutcome: string;
      opportunity: string;
      pursuit: string;
    }
  | {
      action: "speak";
      addressName: string | null;
      replyToName: string | null;
      interpretation: string;
      feltState: string;
      activeDesire: string;
      desiredOutcome: string;
      opportunity: string;
      pursuit: string;
    };
