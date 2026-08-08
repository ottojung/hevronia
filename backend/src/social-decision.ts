import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { createAgent, providerStrategy } from "langchain";
import { z } from "zod";

import { renderParticipantMemoryContexts } from "./long-term-memory/render-context.js";
import type { ParticipantMemoryContext } from "./participant-memory.js";
import { extractText } from "./text.js";
import {
  deserializeTelegramEvent,
  renderTelegramEvent,
  type ObservedTelegramMessage,
} from "./telegram-event.js";

export const socialDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("silence") }).strict(),
  z.object({
    action: z.literal("reply"),
    targetCandidateKey: z.string().min(1),
    motive: z.string().min(1),
    socialAction: z.string().min(1),
    adviceRequested: z.boolean(),
    askQuestion: z.boolean(),
    dreamRelevant: z.boolean(),
    backgroundRelevant: z.boolean(),
  }).strict(),
]);

export type SocialDecision = z.infer<typeof socialDecisionSchema>;

// Provider structured outputs require the root JSON Schema to be an object.
// A top-level discriminated union serializes to `anyOf`, which OpenAI rejects.
// The wrapper keeps the domain union intact while giving the provider an
// object root; callers stay on `SocialDecision` via the unwrapped domain schema.
// Exported so tests can verify the provider-visible schema through the real
// conversion path (`providerStrategy` / `toJsonSchema`).
export const socialDecisionResponseSchema = z.object({
  decision: socialDecisionSchema,
}).strict();

export interface ReplyCandidate {
  key: string;
  messageId: number;
  sender: import("./telegram-event.js").TelegramSenderIdentity;
  senderDisplayName: string;
  text: string;
}

export interface SocialDecisionContext {
  boundedHistory: BaseMessage[];
  currentMessage: ObservedTelegramMessage;
  replyCandidates: ReplyCandidate[];
  participantMemories: ParticipantMemoryContext[];
}

export interface SocialDecisionMaker {
  decide(context: SocialDecisionContext): Promise<SocialDecision>;
}

export interface ResolvedSocialDecision {
  target: ReplyCandidate;
  motive: string;
  socialAction: string;
  adviceRequested: boolean;
  askQuestion: boolean;
  dreamRelevant: boolean;
  backgroundRelevant: boolean;
}

const PLANNING_MODE = `
You are privately planning Хевронія's social behavior, not writing dialogue.
Use the supplied canonical personality as the complete source of truth about her.
Choose silence normally when she has no personal social motive. Select reply targets
only by one of the supplied candidate keys. Return only the requested structured data.
`;

export function renderBoundedConversation(messages: BaseMessage[]): string {
  return messages.map((message) => {
    const content = extractText(message.content).trim();
    if (message.additional_kwargs["lc_source"] === "summarization") {
      return content;
    }
    return renderTelegramEvent(deserializeTelegramEvent(content));
  }).join("\n");
}

export function renderDecisionContext(context: SocialDecisionContext): string {
  return [
    `Chat kind: ${context.currentMessage.chatKind}`,
    `Current stable participant: telegram-${context.currentMessage.sender.kind}:${context.currentMessage.sender.id}`,
    `Current display name: ${context.currentMessage.senderDisplayName}`,
    `Directly addressed: ${context.currentMessage.directlyAddressed}`,
    `Reply relationship: ${JSON.stringify(context.currentMessage.replyTo)}`,
    `Eligible reply candidates: ${JSON.stringify(context.replyCandidates)}`,
    renderParticipantMemoryContexts(context.participantMemories),
    "Bounded canonical conversation:",
    renderBoundedConversation(context.boundedHistory),
  ].join("\n");
}

export function createSocialDecisionMaker(
  model: BaseLanguageModel,
  personality: string,
): SocialDecisionMaker {
  const agent = createAgent({
    model,
    tools: [],
    systemPrompt: `${personality}\n\n${PLANNING_MODE}`,
    responseFormat: providerStrategy(socialDecisionResponseSchema),
  });
  return {
    async decide(context): Promise<SocialDecision> {
      const result = await agent.invoke({
        messages: [new HumanMessage(renderDecisionContext(context))],
      });
      const response = socialDecisionResponseSchema.parse(result.structuredResponse);
      return response.decision;
    },
  };
}
