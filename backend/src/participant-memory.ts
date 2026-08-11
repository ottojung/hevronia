import type { RecalledMemory, LongTermMemorySnapshot } from "./long-term-memory/runtime.js";
import { longTermMemoryUserIdFromTelegramSender } from "./identifiers.js";
import type { TelegramSenderIdentity } from "./telegram-event.js";
import type { VisibleMessage } from "./realizer-schema.js";

const MAX_MEMORY_PARTICIPANTS = 5;

/**
 * The properties that this type carries are:
 * - `memories` contains at least one recalled memory for the participant, so a
 *   rendered context never claims that memories "surfaced" when none did.
 *
 * The proof of those properties is guaranteed by:
 * - `memoriesForCandidates(...)`: satisfies the property because it drops
 *   participants for whom the snapshot returns no memories before building
 *   the context.
 * - `renderParticipantMemoryContexts(...)`: also skips empty memory lists, so
 *   the wording stays honest even for contexts constructed directly by tests.
 */
export interface ParticipantMemoryContext {
  participant: { kind: "user"; id: number };
  memories: readonly RecalledMemory[];
}

export function selectedParticipantIds(candidates: readonly VisibleMessage[]): number[] {
  const selected: number[] = [];
  const seen = new Set<number>();
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate?.sender.kind !== "user") continue;
    if (seen.has(candidate.sender.id)) continue;
    seen.add(candidate.sender.id);
    selected.push(candidate.sender.id);
    if (selected.length >= MAX_MEMORY_PARTICIPANTS) break;
  }
  return selected;
}

export function memoriesForCandidates(
  snapshot: LongTermMemorySnapshot,
  candidates: readonly VisibleMessage[],
): ParticipantMemoryContext[] {
  return selectedParticipantIds(candidates)
    .map((id): ParticipantMemoryContext => ({
      participant: { kind: "user", id },
      memories: snapshot.memoriesFor(longTermMemoryUserIdFromTelegramSender(id)),
    }))
    .filter(({ memories }) => memories.length > 0);
}

export function memoriesForCharacter(
  contexts: readonly ParticipantMemoryContext[],
  sender: TelegramSenderIdentity,
): ParticipantMemoryContext[] {
  if (sender.kind !== "user") return [];
  return contexts.filter(({ participant }) => participant.id === sender.id);
}
