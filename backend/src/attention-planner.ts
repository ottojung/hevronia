import { HumanMessage, SystemMessage, isBaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";

import { renderDreamCharacterList, renderDreamObservations } from "./dream-render.js";
import { errorDetail } from "./error-detail.js";
import { buildHandleChoices } from "./handles.js";
import { renderParticipantMemoryContexts } from "./long-term-memory/render-context.js";
import { invokeWithRateLimitRetry } from "./model-retry.js";
import type { TurnContext } from "./realizer-schema.js";
import { extractText } from "./text.js";

export const PLANNER_PROMPT = `You are a cheap attention pre-filter for Хевронія, a character inside a dream that appears to her through Telegram.

Your only job is to decide whether there is any plausible reason for Хевронія to consider responding to what is happening now. You are NOT deciding whether she should actually reply, whom she should address, what she feels, what she wants, or what she should say. That belongs to a later, smarter stage. You are a recall-oriented gate: when in doubt, say yes.

Return exactly one word: yes or no.

Say "yes" when there is a plausible indication that Хевронія may care enough to consider acting, including when:
- she is directly addressed, directly mentioned, or referred to indirectly;
- somebody replies to or meaningfully continues something she said;
- somebody answers a question she asked;
- an earlier interaction involving her is still unresolved;
- something changes in a situation she was already participating in;
- somebody is clearly trying to get her attention without naming her;
- an event is socially striking, funny, provocative, concerning, surprising, personally relevant, or otherwise plausibly something she could want to react to;
- relevant relationship history or memory makes an otherwise ordinary message potentially important to her;
- there is genuine ambiguity about whether she may want to react.

Say "no" only for ordinary background chatter where there is no plausible reason for Хевронія to get involved. You may also say "no" when something directed at her has already been completely dealt with and the new event adds nothing material, but apply this conservatively. You are a gate, not Хевронія's social mind.

Return only the single word yes or no.`;

export class PlannerOutputError extends Error {
  constructor(rendered: string) {
    super(`Attention planner returned an invalid answer: ${rendered}`);
    this.name = "PlannerOutputError";
  }
}

export type PlannerDecisionLog =
  | { outcome: "pass" }
  | { outcome: "filter" }
  | { outcome: "failure"; errorDetail: string };

export interface AttentionPlanner {
  consider(context: TurnContext): Promise<boolean>;
}

/**
 * Parses the planner's literal output. Anything other than exactly `yes` or
 * `no` (after trimming and case-normalization) is a planner failure.
 */
export function parsePlannerOutput(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized === "yes") return true;
  if (normalized === "no") return false;
  throw new PlannerOutputError(JSON.stringify(text));
}

export function renderPlannerContext(context: TurnContext): string {
  const choices = buildHandleChoices(context.visibleMessages);
  const sections: string[] = [];
  sections.push("In your dream you currently see these characters:");
  sections.push(renderDreamCharacterList(choices.characters));
  sections.push("");
  sections.push("This is the conversation history currently visible to you:");
  sections.push(renderDreamObservations(context.boundedHistory));
  const memories = renderParticipantMemoryContexts(context.participantMemories);
  if (memories !== "") {
    sections.push("");
    sections.push(memories);
  }
  sections.push("");
  sections.push("Is there any plausible reason for Хевронія to consider responding to what is happening now?");
  return sections.join("\n\n");
}

export function createAttentionPlanner(model: BaseLanguageModel): AttentionPlanner {
  return {
    async consider(context: TurnContext): Promise<boolean> {
      const response = await invokeWithRateLimitRetry(() => model.invoke([
        new SystemMessage(PLANNER_PROMPT),
        new HumanMessage(renderPlannerContext(context)),
      ]));
      if (!isBaseMessage(response)) {
        throw new PlannerOutputError(errorDetail(response));
      }
      return parsePlannerOutput(extractText(response.content));
    },
  };
}
