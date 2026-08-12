import { fakeModel } from "@langchain/core/testing";

import type { AttentionPlanner } from "../src/attention-planner.js";
import type { ConversationLayer, ConversationLayerOptions } from "../src/conversation-types.js";
import type { ConversationThreadId, LongTermMemoryUserId } from "../src/identifiers.js";
import { createConversationLayer } from "../src/layer.js";
import type { LongTermMemoryStore, MemoryRecord } from "../src/long-term-memory/index.js";
import type {
  LazyLongTermMemory,
  Scheduler,
} from "../src/long-term-memory/runtime.js";
import type { Realizer } from "../src/realizer.js";
import type {
  RealizerDecision,
  SubjectiveJudgment,
  TurnContext,
} from "../src/realizer-schema.js";

/** Builds a conversation layer with stub models so unit tests never need keys. */
export function testLayer(
  dbPath: string,
  options: ConversationLayerOptions = {},
): ConversationLayer {
  return createConversationLayer({
    dbPath,
    plannerModel: fakeModel(),
    realizerModel: fakeModel(),
    summaryModel: fakeModel(),
    ...options,
  });
}

function judgment(leading: string, alternative: string, whyRejected: string): SubjectiveJudgment {
  return { leading, alternative, whyRejected };
}

export function realizerSilence(): RealizerDecision {
  return {
    action: "silence",
    interpretation: judgment(
      "You read this as an ordinary moment with nothing at stake for you.",
      "They are making a small bid for your attention.",
      "Nothing here engages you personally enough to matter.",
    ),
    intent: judgment(
      "They are just chatting idly, without any clear purpose toward you.",
      "They are quietly testing whether you are still listening.",
      "Their message names no one and asks for no response.",
    ),
    feltState: judgment(
      "This leaves you quietly indifferent.",
      "This leaves you faintly curious.",
      "There is nothing new enough here to spark real interest.",
    ),
    activeDesire: judgment(
      "You want nothing from speaking right now.",
      "You want to keep the peace of the moment unbroken.",
      "No live urge supports spending attention on this.",
    ),
    desiredOutcome: judgment(
      "You want the present calm to remain undisturbed.",
      "You want to stay ready in case something more interesting appears.",
      "Disturbing the calm would serve nothing you actually want.",
    ),
    opportunity: judgment(
      "You notice no opportunity here that advances anything you want.",
      "You could acknowledge them and test how they respond.",
      "Without an active desire, that opportunity is not worth taking.",
    ),
    pursuit: judgment(
      "You decide that staying silent serves you best.",
      "You could offer a one-word acknowledgment.",
      "Saying nothing costs nothing and keeps the calm you want.",
    ),
  };
}

export function realizerSpeak(
  overrides: Partial<Extract<RealizerDecision, { action: "speak" }>> = {},
): Extract<RealizerDecision, { action: "speak" }> {
  return {
    action: "speak",
    addressCharacter: "P1",
    replyToMessage: null,
    interpretation: judgment(
      "You understand this as an ordinary moment worth a short reply.",
      "This is a small bid for your attention that deserves more.",
      "Their light, casual phrasing matches a short reply.",
    ),
    intent: judgment(
      "They want a quick reaction from you.",
      "They are simply passing time in company.",
      "The open phrasing invites a reply more than a report.",
    ),
    feltState: judgment(
      "This leaves you mildly interested.",
      "This leaves you neutral and unengaged.",
      "The message has enough color to hold your attention briefly.",
    ),
    activeDesire: judgment(
      "You want to acknowledge them simply.",
      "You want to keep the exchange at a distance.",
      "A small acknowledgment fits the light tone without investing much.",
    ),
    desiredOutcome: judgment(
      "You want the moment to be acknowledged without fuss.",
      "You want the conversation to deepen into something more personal.",
      "There is no relationship weight here to justify more.",
    ),
    opportunity: judgment(
      "You notice the present interaction gives you room to say a few words.",
      "You could steer the topic toward something that interests you more.",
      "A short reply serves your light aim without commandeering the chat.",
    ),
    pursuit: judgment(
      "You decide to say something short.",
      "You decide to stay silent and let the moment pass.",
      "A short reply acknowledges them without overinvesting.",
    ),
    message: "ага",
    ...overrides,
  };
}

export function passingPlanner(): AttentionPlanner {
  return { consider: async () => true };
}

export function filteringPlanner(): AttentionPlanner {
  return { consider: async () => false };
}

export function stubPlanner(
  passes: (context: TurnContext) => boolean,
): AttentionPlanner {
  return { consider: async (context) => passes(context) };
}

export function stubRealizer(decision: RealizerDecision): Realizer {
  return { realize: async () => decision };
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
