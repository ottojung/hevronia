import type { BaseMessage } from "@langchain/core/messages";

import type { ConversationStore } from "./conversation-store.js";
import type { RespondInput } from "./conversation-types.js";
import { buildHandleChoices } from "./handles.js";
import { longTermMemoryUserIdFromTelegramSender } from "./identifiers.js";
import type { LazyLongTermMemory, LongTermMemorySnapshot } from "./long-term-memory/runtime.js";
import { memoryUserIdForSender } from "./long-term-memory/operations.js";
import type { NaturalNameStore } from "./natural-names/store.js";
import type { MissingNaturalNameChoice } from "./attention-planner.js";
import { missingNaturalNameChoices } from "./attention-planner.js";
import type { PendingConversationWrites } from "./pending-conversation-writes.js";
import { memoriesForCandidates, selectedParticipantIds } from "./participant-memory.js";
import type { ParticipantMemoryContext } from "./participant-memory.js";
import type { VisibleMessage } from "./realizer-schema.js";
import type { NaturalNames } from "./telegram-event.js";
import { visibleMessages } from "./turn-context.js";

export interface TurnMemoryContext {
  history: BaseMessage[];
  candidates: VisibleMessage[];
  participantMemories: ParticipantMemoryContext[];
  naturalNames: NaturalNames;
  namingChoices: readonly MissingNaturalNameChoice[];
}

export async function acquireTurnContext(
  store: ConversationStore,
  canonicalWrites: PendingConversationWrites,
  lazyMemory: LazyLongTermMemory | undefined,
  snapshot: LongTermMemorySnapshot | undefined,
  input: RespondInput,
  naturalNameStore: NaturalNameStore,
): Promise<TurnMemoryContext> {
  const userId = memoryUserIdForSender(input.message.sender);
  if (userId !== undefined && !input.senderIsBot) {
    lazyMemory?.observeUserMessage(
      userId, input.threadId, input.message.text,
    );
  }
  await canonicalWrites.submitAndWait(
    input.threadId, () => store.append(input.threadId, input.message),
  );
  const history = await store.getMessages(input.threadId);
  const candidates = visibleMessages(history);
  const naturalNames = await naturalNameStore.getMany(
    uniqueUserIds(candidates),
  );
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
