import type { LongTermMemory, RecalledMemory } from "../../src/long-term-memory/index.js";

export class EmptyLongTermMemory implements LongTermMemory {
  search(): Promise<RecalledMemory[]> {
    return Promise.resolve([]);
  }

  rememberUserMessage(): Promise<void> {
    return Promise.resolve();
  }

  deleteAll(): Promise<void> {
    return Promise.resolve();
  }
}
