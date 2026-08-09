import type { RecalledMemory, LongTermMemorySnapshot } from "./long-term-memory/runtime.js";
import { longTermMemoryUserIdFromTelegramSender } from "./identifiers.js";
import type { ReplyCandidate } from "./social-decision.js";

const MAX_MEMORY_PARTICIPANTS = 5;

export interface ParticipantMemoryContext {
  participant: { kind: "user"; id: number };
  memories: readonly RecalledMemory[];
}

export function selectedParticipantIds(candidates: readonly ReplyCandidate[]): number[] {
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
  candidates: readonly ReplyCandidate[],
): ParticipantMemoryContext[] {
  return selectedParticipantIds(candidates).map((id) => ({
    participant: { kind: "user", id },
    memories: snapshot.memoriesFor(longTermMemoryUserIdFromTelegramSender(id)),
  }));
}

export function memoriesForTarget(
  contexts: readonly ParticipantMemoryContext[],
  target: ReplyCandidate,
): ParticipantMemoryContext[] {
  if (target.sender.kind !== "user") return [];
  return contexts.filter(({ participant }) => participant.id === target.sender.id);
}
