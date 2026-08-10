import { HumanMessage, SystemMessage, isBaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";

import type { ConversationStore } from "./conversation-store.js";
import type { RespondInput } from "./conversation-types.js";
import { toSilenceLog, toSpeakLog } from "./decision-log.js";
import { GeneratedTurn } from "./generated-turn.js";
import type { LazyLongTermMemory } from "./long-term-memory/runtime.js";
import { PendingConversationWrites } from "./pending-conversation-writes.js";
import { memoriesForCharacter } from "./participant-memory.js";
import type {
  SocialDecisionLog,
  SocialDecisionMaker,
} from "./social-decision.js";
import { extractText } from "./text.js";
import { InvalidRealizationResponseError, realizationContext } from "./turn-context.js";
import {
  UnresolvableSpeakDecisionError,
  deliveredEvent,
  replyRelationshipFor,
  resolveSpeakDecision,
} from "./speak-resolution.js";
import { acquireTurnContext } from "./turn-memory.js";

export interface RespondTurnDependencies {
  store: ConversationStore;
  planner: SocialDecisionMaker;
  model: BaseLanguageModel;
  personality: string;
  canonicalWrites: PendingConversationWrites;
  lazyMemory?: LazyLongTermMemory;
  onSocialDecision?: (log: SocialDecisionLog) => void;
}

export async function respondTurn(
  dependencies: RespondTurnDependencies,
  input: RespondInput,
): Promise<GeneratedTurn> {
  const { lazyMemory } = dependencies;
  const memoryTurn = lazyMemory?.beginTurn();
  try {
    const { history, candidates, participantMemories } = await acquireTurnContext(
      dependencies.store, dependencies.canonicalWrites, lazyMemory,
      memoryTurn?.snapshot, input,
    );
    const decision = await dependencies.planner.decide({
      boundedHistory: history, currentMessage: input.message,
      visibleMessages: candidates, participantMemories,
    });
    if (decision.action === "silence") {
      dependencies.onSocialDecision?.(toSilenceLog(decision));
      return GeneratedTurn.fromSilence();
    }
    const speak = resolveSpeakDecision(decision, candidates);
    if (speak === undefined) {
      throw new UnresolvableSpeakDecisionError(decision.addressCharacter, decision.replyToMessage);
    }
    dependencies.onSocialDecision?.(toSpeakLog(speak));
    const focusSender = speak.address !== null
      ? speak.address.character.sender
      : speak.replyTo !== null ? speak.replyTo.message.sender : undefined;
    const focusMemories = focusSender === undefined
      ? []
      : memoriesForCharacter(participantMemories, focusSender);
    const response = await dependencies.model.invoke([
      new SystemMessage(dependencies.personality),
      new HumanMessage(realizationContext(
        history, focusMemories, speak.address, speak.subjective, candidates,
      )),
    ]);
    if (!isBaseMessage(response)) throw new InvalidRealizationResponseError();
    const replyText = extractText(response.content).trim();
    if (!replyText) throw new InvalidRealizationResponseError();
    const replyTo = replyRelationshipFor(speak.replyTo);
    return GeneratedTurn.fromSpeak(replyText, replyTo, (messageId) => {
      const delivered = deliveredEvent(
        messageId, input.hevroniaSender, replyText, input.message, replyTo,
      );
      dependencies.canonicalWrites.enqueue(
        input.threadId, () => dependencies.store.append(input.threadId, delivered),
      );
    });
  } finally {
    memoryTurn?.release();
  }
}
