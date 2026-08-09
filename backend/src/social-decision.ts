import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { createAgent, providerStrategy } from "langchain";
import { z } from "zod";

import { renderDreamChatKind, renderDreamObservations } from "./dream-render.js";
import { renderParticipantMemoryContexts } from "./long-term-memory/render-context.js";
import type { ParticipantMemoryContext } from "./participant-memory.js";
import { renderReplyChoices } from "./reply-choices.js";

export const socialDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("silence") }).strict(),
  z.object({
    action: z.literal("reply"),
    targetChoice: z.string().min(1),
    interpretation: z.string().min(1),
    activeDesire: z.string().min(1),
    desiredOutcome: z.string().min(1),
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
  messageId: number;
  sender: import("./telegram-event.js").TelegramSenderIdentity;
  senderDisplayName: string;
  text: string;
}

export interface SocialDecisionContext {
  boundedHistory: BaseMessage[];
  currentMessage: import("./telegram-event.js").ObservedTelegramMessage;
  replyCandidates: ReplyCandidate[];
  participantMemories: ParticipantMemoryContext[];
}

export interface SocialDecisionMaker {
  decide(context: SocialDecisionContext): Promise<SocialDecision>;
}

export interface ResolvedSocialDecision {
  target: ReplyCandidate;
  interpretation: string;
  activeDesire: string;
  desiredOutcome: string;
}

const PLANNING_MODE = `
You are at the private moment before any new Telegram message appears from you.
Observe what appeared in the dream and apply Хевронія's Procedural interpretation.
Decide whether what appeared activates something Хевронія herself wants.
If she wants nothing from speaking, choose silence.
If she wants to speak, choose one reply choice (a currently visible Telegram
message) and state briefly how she interprets the event, which desire is active,
and what result she wants from speaking.
Reply choices are private handles valid only for this moment; they are not
identities.
This is private cognition, not dialogue.
Return only the requested structured data.
`;

export function renderDecisionContext(context: SocialDecisionContext): string {
  const sections: string[] = [];
  sections.push("What is appearing in the dream now");
  sections.push(renderDreamChatKind(context.currentMessage.chatKind));
  sections.push(renderDreamObservations(context.boundedHistory));
  const memories = renderParticipantMemoryContexts(context.participantMemories);
  if (memories !== "") sections.push(memories);
  sections.push(renderReplyChoices(context.replyCandidates));
  return sections.join("\n\n");
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
