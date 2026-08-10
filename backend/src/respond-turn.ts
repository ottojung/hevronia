import { HumanMessage, SystemMessage, isBaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";

import type { ConversationStore } from "./conversation-store.js";
import type { RespondInput } from "./conversation-types.js";
import { GeneratedTurn } from "./generated-turn.js";
import { longTermMemoryUserIdFromTelegramSender } from "./identifiers.js";
import type { LazyLongTermMemory } from "./long-term-memory/runtime.js";
import { memoryUserIdForSender } from "./long-term-memory/operations.js";
import { PendingConversationWrites } from "./pending-conversation-writes.js";
import { memoriesForCandidates, memoriesForTarget, selectedParticipantIds } from "./participant-memory.js";
import type { SocialDecisionMaker } from "./social-decision.js";
import { extractText } from "./text.js";
import { InvalidRealizationResponseError, deliveredEvent, realizationContext,
  replyCandidates, replyRelationship, resolveDecision } from "./turn-context.js";

export interface RespondTurnDependencies {
  store: ConversationStore;
  planner: SocialDecisionMaker;
  model: BaseLanguageModel;
  personality: string;
  canonicalWrites: PendingConversationWrites;
  lazyMemory?: LazyLongTermMemory;
}

export async function respondTurn(
  dependencies: RespondTurnDependencies,
  input: RespondInput,
): Promise<GeneratedTurn> {
  const { lazyMemory } = dependencies;
  const memoryTurn = lazyMemory?.beginTurn();
  try {
    const userId = memoryUserIdForSender(input.message.sender);
    if (userId !== undefined && !input.senderIsBot) {
      lazyMemory?.observeUserMessage(
        userId, input.threadId, input.message.text,
      );
    }
    await dependencies.canonicalWrites.submitAndWait(
      input.threadId, () => dependencies.store.append(input.threadId, input.message),
    );
    const history = await dependencies.store.getMessages(input.threadId);
    const candidates = replyCandidates(history);
    const currentSenderId = input.message.sender.kind === "user"
      ? input.message.sender.id
      : undefined;
    for (const participantId of selectedParticipantIds(candidates)) {
      if (input.senderIsBot && participantId === currentSenderId) continue;
      lazyMemory?.warmUser(longTermMemoryUserIdFromTelegramSender(participantId));
    }
    const snapshot = memoryTurn?.snapshot;
    const participantMemories = snapshot === undefined
      ? []
      : memoriesForCandidates(snapshot, candidates);
    let decision: Awaited<ReturnType<typeof dependencies.planner.decide>>;
    try {
      decision = await dependencies.planner.decide({
        boundedHistory: history, currentMessage: input.message,
        replyCandidates: candidates, participantMemories,
      });
    } catch (error) {
      console.warn(`Social decision failed safely to silence: ${String(error)}`);
      decision = { action: "silence" };
    }
    if (decision.action === "silence") {
      return GeneratedTurn.fromSilence();
    }
    const resolved = resolveDecision(decision, candidates);
    if (resolved === undefined) {
      return GeneratedTurn.fromSilence();
    }
    const response = await dependencies.model.invoke([
      new SystemMessage(dependencies.personality),
      new HumanMessage(realizationContext(
        history, input.message.chatKind,
        memoriesForTarget(participantMemories, resolved.target), resolved,
      )),
    ]);
    if (!isBaseMessage(response)) throw new InvalidRealizationResponseError();
    const replyText = extractText(response.content).trim();
    if (!replyText) throw new InvalidRealizationResponseError();
    return GeneratedTurn.fromReply(replyText, replyRelationship(resolved.target), (messageId) => {
      const delivered = deliveredEvent(
        messageId, input.hevroniaSender, replyText, input.message, resolved.target,
      );
      dependencies.canonicalWrites.enqueue(
        input.threadId, () => dependencies.store.append(input.threadId, delivered),
      );
    });
  } finally {
    memoryTurn?.release();
  }
}

export function warmParticipant(
  lazyMemory: LazyLongTermMemory | undefined,
  sender: import("./telegram-event.js").TelegramSenderIdentity,
): void {
  const userId = memoryUserIdForSender(sender);
  if (userId !== undefined) {
    lazyMemory?.warmUser(userId);
  }
}
