import type { ConversationThreadId, LongTermMemoryUserId } from "../../src/identifiers.js";
import type { LongTermMemory, RecalledMemory } from "../../src/long-term-memory/index.js";

export class SeededLongTermMemory implements LongTermMemory {
  constructor(private readonly facts: readonly string[]) {}

  search(
    _userId: LongTermMemoryUserId,
    _query: string,
    topK: number,
  ): Promise<RecalledMemory[]> {
    return Promise.resolve(this.facts.slice(0, topK).map((text) => ({ text })));
  }

  rememberUserMessage(
    _userId: LongTermMemoryUserId,
    _threadId: ConversationThreadId,
    _userMessage: string,
  ): Promise<void> {
    return Promise.resolve();
  }

  deleteAll(_userId: LongTermMemoryUserId): Promise<void> {
    return Promise.resolve();
  }
}
