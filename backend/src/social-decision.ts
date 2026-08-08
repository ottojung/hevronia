import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { createAgent, providerStrategy } from "langchain";
import { z } from "zod";

import { extractText } from "./text.js";

export const socialDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("silence") }).strict(),
  z
    .object({
      action: z.literal("reply"),
      replyToMessageId: z.number().int().positive(),
      motive: z.string().min(1),
      socialAction: z.string().min(1),
      adviceRequested: z.boolean(),
      askQuestion: z.boolean(),
      dreamRelevant: z.boolean(),
      backgroundRelevant: z.boolean(),
    })
    .strict(),
]);

export type SocialDecision = z.infer<typeof socialDecisionSchema>;

export interface SocialDecisionMaker {
  decide(transcript: string): Promise<SocialDecision>;
}

const DECISION_PROMPT = `
You privately decide whether Хевронія speaks in an observed Telegram conversation.
Return only the structured decision requested by the schema.

Хевронія is a participant, not a response service. Silence is normal when she has no
personal social motive. Direct address strongly favours replying but is not a command
interface. A disclosure is social communication, not an implicit request for help.

For a reply, identify the exact message, a concise personal motive and social action,
and explicitly decide whether advice was requested, whether a question is genuinely
motivated, and whether the dream premise or remembered background is relevant.
Questions are not engagement hooks. Advice is absent unless requested or exceptionally
natural. Dream and background relevance are usually false.

This is private planning. Never compose Хевронія's message here.
`;

export function createSocialDecisionMaker(model: BaseLanguageModel): SocialDecisionMaker {
  const agent = createAgent({
    model,
    tools: [],
    systemPrompt: DECISION_PROMPT,
    responseFormat: providerStrategy(socialDecisionSchema),
  });
  return {
    async decide(transcript): Promise<SocialDecision> {
      const result = await agent.invoke({ messages: [new HumanMessage(transcript)] });
      return socialDecisionSchema.parse(result.structuredResponse);
    },
  };
}

export function renderObservedTranscript(messages: BaseMessage[], currentEvent: string): string {
  const lines = messages.flatMap((message) => {
    const content = extractText(message.content).trim();
    if (!content) {
      return [];
    }
    if (message instanceof AIMessage) {
      return [`Хевронія: ${content}`];
    }
    const eventPrefix = "Observed Telegram event:\n";
    if (content.startsWith(eventPrefix)) {
      const event = content.slice(eventPrefix.length).split("\n", 1)[0];
      return event === undefined ? [] : [event];
    }
    return [content];
  });
  lines.push(currentEvent);
  return [
    "You are observing this Telegram conversation as a group-chat transcript.",
    "Each event preserves its speaker identity; nobody below is an AI assistant's generic user.",
    "",
    ...lines,
    "",
    "Decide what Хевронія does now.",
  ].join("\n");
}

export function renderDecisionForRealization(
  observedEvent: string,
  decision: Exclude<SocialDecision, { action: "silence" }>,
): string {
  return [
    "Observed Telegram event:",
    observedEvent,
    "",
    "Private social decision (constraints for realization, not text to repeat):",
    JSON.stringify(decision),
    "",
    "Write only the Telegram message Хевронія actually sends. Do not expose the decision or JSON.",
  ].join("\n");
}
