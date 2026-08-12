import type { BaseMessage } from "@langchain/core/messages";

import type { ConversationStore } from "./conversation-store.js";
import type { RespondInput } from "./conversation-types.js";
import { buildHandleChoices } from "./handles.js";
import { longTermMemoryUserIdFromTelegramSender } from "./identifiers.js";
import type { LazyLongTermMemory, LongTermMemorySnapshot } from "./long-term-memory/runtime.js";
import { memoryUserIdForSender } from "./long-term-memory/operations.js";
import type { NaturalNameStore } from "./natural-names/store.js";
import type { MissingNaturalNameChoice } from "./planner-schema.js";
import { missingNaturalNameChoices } from "./planner-schema.js";
import type { PendingConversationWrites } from "./pending-conversation-writes.js";
import { memoriesForCandidates, selectedParticipantIds } from "./participant-memory.js";
import type { ParticipantMemoryContext } from "./participant-memory.js";
import type { VisibleMessage } from "./realizer-schema.js";
import type { NaturalNames } from "./telegram-event.js";
import { visibleMessages } from "./turn-context.js";

export interface ReactionContextState {
  history: BaseMessage[];
  candidates: VisibleMessage[];
  participantMemories: ParticipantMemoryContext[];
  naturalNames: NaturalNames;
  namingChoices: readonly MissingNaturalNameChoice[];
}

/**
 * Observes an incoming event: long-term-memory observation plus canonical
 * persistence. This happens exactly once per incoming message, independently
 * of any planner/realizer reaction, so restarting or cancelling cognition never
 * re-observes the message.
 */
export async function observeIncoming(
  store: ConversationStore,
  canonicalWrites: PendingConversationWrites,
  lazyMemory: LazyLongTermMemory | undefined,
  input: RespondInput,
): Promise<void> {
  const userId = memoryUserIdForSender(input.message.sender);
  if (userId !== undefined && !input.senderIsBot) {
    lazyMemory?.observeUserMessage(
      userId, input.threadId, input.message.text,
    );
  }
  await canonicalWrites.submitAndWait(
    input.threadId, () => store.append(input.threadId, input.message),
  );
}

/**
 * Acquires the reaction context from the already-persisted canonical state:
 * bounded history, visible messages, natural names, naming choices, and
 * participant memories. Never persists and never re-observes the incoming
 * message.
 */
export async function acquireReactionContext(
  store: ConversationStore,
  canonicalWrites: PendingConversationWrites,
  lazyMemory: LazyLongTermMemory | undefined,
  snapshot: LongTermMemorySnapshot | undefined,
  input: RespondInput,
  naturalNameStore: NaturalNameStore,
): Promise<ReactionContextState> {
  await canonicalWrites.waitForThread(input.threadId);
  const history = await store.getMessages(input.threadId);
  const candidates = visibleMessages(history);
  const naturalNames = await naturalNameStore.getMany(uniqueUserIds(candidates));
  const namingChoices = missingNaturalNameChoices(
    buildHandleChoices(candidates, naturalNames).characters,
    naturalNames,
  );
  const currentSenderId = input.message.sender.kind === "user"
    ? input.message.sender.id
    : undefined;
  for (const participantId of selectedParticipantIds(candidates)) {
    if (input.senderIsBot && participantId === currentSenderId) continue;
    lazyMemory?.warmUser(longTermMemoryUserIdFromTelegramSender(participantId));
  }
  const participantMemories = snapshot === undefined
    ? []
    : memoriesForCandidates(snapshot, candidates);
  return { history, candidates, participantMemories, naturalNames, namingChoices };
}

function uniqueUserIds(candidates: readonly VisibleMessage[]): number[] {
  const ids = new Set<number>();
  for (const candidate of candidates) {
    if (candidate.sender.kind === "user") ids.add(candidate.sender.id);
  }
  return [...ids];
}
