import { HumanMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { z } from "zod";
import { createAgent, providerStrategy, toolStrategy } from "langchain";

import { renderConversationFraming, renderDreamCharacterList, renderDreamObservations } from "./dream-render.js";
import { buildHandleChoices } from "./handles.js";
import type { CharacterHandle } from "./handles.js";
import { invokeWithRateLimitRetry } from "./model-retry.js";
import { isGeminiChatModel } from "./model.js";
import { MAX_NATURAL_NAME_LENGTH, naturalNameSchema } from "./natural-names/schema.js";
import type { ConstFreeJsonSchema, TurnContext } from "./realizer-schema.js";
import { renderParticipantMemoryContexts } from "./long-term-memory/render-context.js";
import type { NaturalNames } from "./telegram-event.js";
import { notebookSubject } from "./telegram-event.js";

export const PLANNER_PROMPT = `You are a cheap attention pre-filter and name-assigner for Хевронія, a character inside a dream that appears to her through Telegram.

Your attention job is to decide whether there is any plausible reason for Хевронія to consider responding to what is happening now. You are NOT deciding whether she should actually reply, whom she should address, what she feels, what she wants, or what she should say. That belongs to a later, smarter stage. You are a recall-oriented gate: when in doubt, say yes.

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

Your naming job: the notebook has no natural name yet for each visible person listed under "Names to assign" in the context. For every one of them, choose exactly one short natural name that Хевронія would comfortably use in conversation. Derive it from the person's Telegram display name or username where one suggests a name, and otherwise pick something short and natural. Everyone listed under "Names to assign" must receive a name; nobody outside that list may be given a name or renamed. Names stay short, colloquial, and conversational — normally one or two words, in the language of the conversation (Ukrainian) when the source is Ukrainian, transliterated naturally when the source is foreign. Do not use a raw handle, a description, or a bare Telegram username as the name.

Return exactly the required structured output: attention as "yes" or "no", and naturalNames keyed by the exact handles listed under "Names to assign".`;

export class PlannerOutputError extends Error {
  constructor(rendered: string) {
    super(`Attention planner returned an invalid answer: ${rendered}`);
    this.name = "PlannerOutputError";
  }
}

export interface MissingNaturalNameChoice {
  /** Ephemeral per-turn character handle, aligned with the realizer's P-handles. */
  handle: string;
  sender: { kind: "user"; id: number };
  /** The name Telegram currently displays for this person. */
  displayName: string;
  /** The Telegram @username, if known. */
  username: string | null;
}

export interface PlannerDecision {
  attention: boolean;
  /** Proposed natural names keyed by the exact naming-choice handles. */
  naturalNames: Readonly<Record<string, string>>;
}

export type PlannerDecisionLog =
  | {
      outcome: "pass" | "filter";
      attention: boolean;
      naturalNames: Readonly<Record<string, string>>;
    }
  | { outcome: "failure"; errorDetail: string };

export interface AttentionPlanner {
  consider(
    context: TurnContext,
    namingChoices: readonly MissingNaturalNameChoice[],
  ): Promise<PlannerDecision>;
}

/**
 * The exact naming choices for a turn, derived from the same character
 * handles the realizer sees. Only visible `kind: "user"` characters without a
 * persisted natural name are eligible; channels, already-named users, stale
 * handles, and raw Telegram ids never appear. The prompt, the zod schema, the
 * provider JSON schema, and persistence all consume this single collection.
 */
export function missingNaturalNameChoices(
  characters: readonly CharacterHandle[],
  naturalNames: NaturalNames,
): MissingNaturalNameChoice[] {
  const choices: MissingNaturalNameChoice[] = [];
  for (const { handle, character } of characters) {
    if (character.sender.kind !== "user") continue;
    if (naturalNames.has(character.sender.id)) continue;
    choices.push({
      handle,
      sender: { kind: "user", id: character.sender.id },
      displayName: character.displayName,
      username: character.username,
    });
  }
  return choices;
}

interface PlannerResponse {
  attention: "yes" | "no";
  naturalNames: Record<string, string>;
}

/**
 * Builds the planner's expected response schema dynamically from the exact
 * per-turn naming choices: the unnamed visible user handles are the only
 * properties of `naturalNames`, every one is required, and nothing else is
 * allowed. A turn with no unnamed users yields an empty, strict `naturalNames`.
 */
export function buildPlannerResponseSchema(
  namingChoices: readonly MissingNaturalNameChoice[],
): z.ZodType<PlannerResponse> {
  const naturalNames = z.object(
    Object.fromEntries(namingChoices.map(({ handle }) => [handle, naturalNameSchema])),
  ).strict();
  return z.object({
    attention: z.enum(["yes", "no"]),
    naturalNames,
  }).strict();
}

/**
 * Plain, fully inlined provider JSON Schema mirroring the zod schema: the
 * exact naming-choice handles are the only `naturalNames` properties, are all
 * required, and no other property is allowed. Both provider paths expose the
 * identical strict structure.
 */
export function buildPlannerJsonSchema(
  namingChoices: readonly MissingNaturalNameChoice[],
): ConstFreeJsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      attention: { type: "string", enum: ["yes", "no"] },
      naturalNames: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          namingChoices.map(({ handle }) => [
            handle,
            { type: "string", minLength: 1, maxLength: MAX_NATURAL_NAME_LENGTH },
          ]),
        ),
        required: namingChoices.map(({ handle }) => handle),
      },
    },
    required: ["attention", "naturalNames"],
  };
}

export function renderPlannerContext(
  context: TurnContext,
  namingChoices: readonly MissingNaturalNameChoice[],
): string {
  const choices = buildHandleChoices(context.visibleMessages, context.naturalNames);
  const sections: string[] = [];
  sections.push("In your dream you currently see these characters:");
  sections.push(renderDreamCharacterList(choices.characters));
  if (namingChoices.length > 0) {
    sections.push("");
    sections.push("Names to assign:");
    sections.push(namingChoices.map(({ handle, sender, displayName, username }) => {
      const user = username === null || username === "" ? "" : `, username @${username}`;
      return `${handle} = ${notebookSubject(sender)}, currently displayed as “${displayName}”${user}.`;
    }).join("\n"));
  }
  sections.push("");
  sections.push("This is the conversation history currently visible to you:");
  sections.push(renderDreamObservations(context.boundedHistory, undefined, context.naturalNames));
  sections.push("");
  sections.push(renderConversationFraming(context.currentMessage.chatKind));
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
    async consider(
      context: TurnContext,
      namingChoices: readonly MissingNaturalNameChoice[],
    ): Promise<PlannerDecision> {
      // Nothing to name and the event is unambiguously directed at Хевронія:
      // skip the model entirely, because the gate must never turn a private
      // chat or a direct address into an irreversible false negative.
      if (namingChoices.length === 0 &&
          (context.currentMessage.chatKind === "private"
            || context.currentMessage.directlyAddressed)) {
        return { attention: true, naturalNames: {} };
      }
      const schema = buildPlannerResponseSchema(namingChoices);
      const agent = isGeminiChatModel(model)
        ? createAgent({
            model,
            tools: [],
            systemPrompt: PLANNER_PROMPT,
            responseFormat: toolStrategy(buildPlannerJsonSchema(namingChoices)),
          })
        : createAgent({
            model,
            tools: [],
            systemPrompt: PLANNER_PROMPT,
            responseFormat: providerStrategy(buildPlannerJsonSchema(namingChoices)),
          });
      const result = await invokeWithRateLimitRetry(() => agent.invoke({
        messages: [new HumanMessage(renderPlannerContext(context, namingChoices))],
      }));
      const response = schema.parse(result.structuredResponse);
      return {
        attention: response.attention === "yes",
        naturalNames: response.naturalNames,
      };
    },
  };
}
