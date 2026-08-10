import type { ConversationThreadId, LongTermMemoryUserId } from "../src/identifiers.js";
import type { LongTermMemoryStore, MemoryRecord } from "../src/long-term-memory/index.js";
import type {
  LazyLongTermMemory,
  Scheduler,
} from "../src/long-term-memory/runtime.js";
import type { SocialDecision } from "../src/social-decision.js";

export function silenceDecision(): SocialDecision {
  return {
    action: "silence",
    interpretation: "You read this as an ordinary moment with nothing at stake for you.",
    feltState: "This leaves you quietly indifferent.",
    activeDesire: "You want nothing from speaking right now.",
    desiredOutcome: "You want the present calm to remain undisturbed.",
    opportunity: "You notice no opportunity here that advances anything you want.",
    pursuit: "You decide that staying silent serves you best.",
  };
}

export interface SearchCall {
  userId: string;
  query: string;
  topK: number;
}

export interface RememberCall {
  userId: string;
  threadId: string;
  text: string;
}

export class FakeScheduler implements Scheduler {
  private nextId = 1;
  readonly pending: {
    id: number;
    callback: () => void;
    delayMs: number;
    cancelled: boolean;
  }[] = [];

  schedule(callback: () => void, delayMs: number): () => void {
    const entry = { id: this.nextId, callback, delayMs, cancelled: false };
    this.nextId += 1;
    this.pending.push(entry);
    return () => { entry.cancelled = true; };
  }

  get count(): number {
    return this.pending.filter((entry) => !entry.cancelled).length;
  }

  fireEarliest(): boolean {
    const next = [...this.pending]
      .filter((entry) => !entry.cancelled)
      .sort((a, b) => a.id - b.id)[0];
    if (next === undefined) return false;
    next.cancelled = true;
    next.callback();
    return true;
  }

  async fireAll(): Promise<void> {
    for (let guard = 0; guard < 10_000; guard += 1) {
      this.fireEarliest();
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (this.count === 0) break;
    }
  }
}

export class FakeStore implements LongTermMemoryStore {
  readonly searchCalls: SearchCall[] = [];
  readonly rememberCalls: RememberCall[] = [];
  readonly deleteAllCalls: string[] = [];
  searchImpl?: (
    userId: string,
    query: string,
    topK: number,
  ) => MemoryRecord[] | Promise<MemoryRecord[]>;
  rememberImpl?: (
    userId: string,
    threadId: string,
    text: string,
  ) => MemoryRecord[] | Promise<MemoryRecord[]>;
  activeSearches = 0;
  maxActiveSearches = 0;

  async search(userId: LongTermMemoryUserId, query: string, topK: number): Promise<MemoryRecord[]> {
    this.searchCalls.push({ userId: userId.toPersistenceKey(), query, topK });
    this.activeSearches += 1;
    this.maxActiveSearches = Math.max(this.maxActiveSearches, this.activeSearches);
    try {
      if (this.searchImpl !== undefined) {
        return await this.searchImpl(userId.toPersistenceKey(), query, topK);
      }
      return [];
    } finally {
      this.activeSearches -= 1;
    }
  }

  async rememberUserMessage(
    userId: LongTermMemoryUserId,
    threadId: ConversationThreadId,
    userMessage: string,
  ): Promise<MemoryRecord[]> {
    this.rememberCalls.push({
      userId: userId.toPersistenceKey(),
      threadId: threadId.toPersistenceKey(),
      text: userMessage,
    });
    if (this.rememberImpl !== undefined) {
      return await this.rememberImpl(userId.toPersistenceKey(), threadId.toPersistenceKey(), userMessage);
    }
    return [];
  }

  async deleteAll(userId: LongTermMemoryUserId): Promise<void> {
    this.deleteAllCalls.push(userId.toPersistenceKey());
  }
}

export function fact(id: string, text: string, score?: number): MemoryRecord {
  return { id, text, ...(score === undefined ? {} : { score }) };
}

export function staticMemory(
  facts: ReadonlyMap<string, { text: string }[]>,
): LazyLongTermMemory {
  return {
    beginTurn() {
      const snapshot = new Map(facts);
      return {
        snapshot: {
          memoriesFor(userId: LongTermMemoryUserId) {
            return snapshot.get(userId.toPersistenceKey()) ?? [];
          },
        },
        release() {},
      };
    },
    warmUser(_userId: LongTermMemoryUserId) {},
    observeUserMessage(_userId: LongTermMemoryUserId, _threadId: ConversationThreadId, _text: string) {},
    close(): Promise<void> { return Promise.resolve(); },
  };
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
