import type { LongTermMemory, RecalledMemory } from "./long-term-memory/index.js";
import { recallForTurn } from "./long-term-memory/operations.js";
import { longTermMemoryUserIdFromTelegramSender } from "./identifiers.js";
import type { ReplyCandidate } from "./social-decision.js";

const MAX_MEMORY_PARTICIPANTS = 5;

export interface ParticipantMemoryContext {
  participant: { kind: "user"; id: number };
  memories: RecalledMemory[];
}

export async function recallForCandidates(
  memory: LongTermMemory | undefined,
  candidates: ReplyCandidate[],
): Promise<ParticipantMemoryContext[]> {
  const latestByUser = new Map<number, ReplyCandidate>();
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate?.sender.kind === "user" && !latestByUser.has(candidate.sender.id)) {
      latestByUser.set(candidate.sender.id, candidate);
    }
    if (latestByUser.size >= MAX_MEMORY_PARTICIPANTS) break;
  }
  return Promise.all([...latestByUser.values()].map(async (candidate) => ({
    participant: { kind: "user", id: candidate.sender.id },
    memories: await recallForTurn(
      memory,
      longTermMemoryUserIdFromTelegramSender(candidate.sender.id),
      candidate.text,
    ),
  })));
}

export function memoriesForTarget(
  contexts: ParticipantMemoryContext[],
  target: ReplyCandidate,
): ParticipantMemoryContext[] {
  if (target.sender.kind !== "user") return [];
  return contexts.filter(({ participant }) => participant.id === target.sender.id);
}
