import { fakeModel } from "@langchain/core/testing";
import type { BaseMessageLike } from "@langchain/core/messages";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { RunnableLambda } from "@langchain/core/runnables";

import type {
  AttentionPlanner,
  MissingNaturalNameChoice,
  PlannerDecision,
} from "../src/attention-planner.js";
import type { ConversationLayer, ConversationLayerOptions } from "../src/conversation-types.js";
import type { ConversationThreadId, LongTermMemoryUserId } from "../src/identifiers.js";
import { createConversationLayer } from "../src/layer.js";
import type { LongTermMemoryStore, MemoryRecord } from "../src/long-term-memory/index.js";
import type {
  LazyLongTermMemory,
  Scheduler,
} from "../src/long-term-memory/runtime.js";
import type { Realizer } from "../src/realizer.js";
import type { StructuredOutputChatModel } from "../src/realizer-call.js";
import type { RealizerDecision } from "../src/realizer-schema.js";
import type { TurnContext } from "../src/realizer-response-schema.js";

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

export function realizerSilence(): RealizerDecision {
  return {
    action: "silence",
    addressCharacter: null,
    replyToMessage: null,
    message: null,
    interpretation: "You read this as an ordinary moment with a story you could place, but nothing needs saying now.",
    presentMind: {
      immediate: "A light ordinary message arrives and you notice its casual, unguarded tone.",
      culturalThought: "You are thinking about the part of Lothar's story where people fled Stormwind and had to decide what possessions to carry.",
      foreground: "The casual message stays light, while the image of the refugees deciding what to carry quietly holds your attention.",
    },
    characterIntent: "They are just chatting idly, without any clear purpose toward you.",
    realityRelation: {
      kind: "difference",
      content: "Here a person chats freely with a total stranger, where back home most talk ran through people who knew each other, or quickly became known.",
    },
    dreamIntent: "The dream appears to be producing ordinary low-significance social material to keep the environment comfortable.",
    feltState: "This leaves you quietly attentive.",
    activeDesire: {
      motive: "softPower",
      strength: "weak",
      content: "You want this stranger to carry the image of refugees choosing which pieces of home to take after Stormwind fell.",
      basis: "It is a real valued inherited story, they do not yet have this image, and putting it into their mind serves your standing soft-power desire.",
    },
    desiredOutcome: "The stranger now holds that image of the refugees deciding what to carry.",
    opportunity: "Their easy, unguarded presence gives the story somewhere to land whenever you choose to share it.",
    fiveTurnStrategy: "Share the story naturally when the moment feels open, without laboring it.",
    fiftyTurnStrategy: "As a recurring stranger, let such remembered stories surface occasionally, never as a lecture.",
  };
}

export function realizerSpeak(
  overrides: Partial<RealizerDecision> = {},
): RealizerDecision {
  return {
    action: "speak",
    addressCharacter: "P1",
    replyToMessage: null,
    message: "ага",
    interpretation: "You understand this as an ordinary moment worth a short reply.",
    presentMind: {
      immediate: "You notice the light casual tone and feel a small impulse to answer in kind.",
      culturalThought: "You are thinking of the Uther stories from childhood — that a person could be so strong and still believe strength must answer to something.",
      foreground: "The casual tone feels familiar and warm, and the Uther image sits beside it, unforced.",
    },
    characterIntent: "They want a quick reaction from you.",
    realityRelation: {
      kind: "correspondence",
      content: "The brisk exchange of pleasantries closely resembles the easy patter of people trading news in a market square at home.",
    },
    dreamIntent: "The dream seems to be maintaining an ordinary, unremarkable interaction.",
    feltState: "This leaves you mildly interested.",
    activeDesire: {
      motive: "softPower",
      strength: "weak",
      content: "You want them to have the Uther image: strength that believes it must answer to something.",
      basis: "It is a real valued story from home, they do not yet carry this image, and you want it to exist in their mind.",
    },
    desiredOutcome: "They now hold that image of strength answerable to conscience.",
    opportunity: "Their light tone gives the image a natural opening if you let it surface.",
    fiveTurnStrategy: "Say something short now and see how the moment lands.",
    fiftyTurnStrategy: "You are not building anything long-term with this person yet, but you would let such remembered stories recur naturally if they did.",
    ...overrides,
  };
}

export function passingPlanner(): AttentionPlanner {
  return { consider: async () => ({ attention: true, naturalNames: {} }) };
}

export function filteringPlanner(): AttentionPlanner {
  return { consider: async () => ({ attention: false, naturalNames: {} }) };
}

export function stubPlanner(
  passes: (context: TurnContext) => boolean,
): AttentionPlanner {
  return {
    consider: async (context) => ({
      attention: passes(context),
      naturalNames: {},
    }),
  };
}

export function stubPlannerDecision(
  decide: (
    context: TurnContext,
    namingChoices: readonly MissingNaturalNameChoice[],
  ) => PlannerDecision,
): AttentionPlanner {
  return { consider: async (context, namingChoices) => decide(context, namingChoices) };
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
  texts: string[];
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
    messages: readonly string[],
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

  async rememberUserMessages(
    userId: LongTermMemoryUserId,
    threadId: ConversationThreadId,
    messages: readonly string[],
  ): Promise<MemoryRecord[]> {
    this.rememberCalls.push({
      userId: userId.toPersistenceKey(),
      threadId: threadId.toPersistenceKey(),
      texts: [...messages],
    });
    if (this.rememberImpl !== undefined) {
      return await this.rememberImpl(
        userId.toPersistenceKey(), threadId.toPersistenceKey(), messages,
      );
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

/**
 * A minimal chat model whose structured-output path returns a fixed decision
 * while recording every message array it was invoked with. Used in tests that
 * need to inspect the exact prompt sent to the realizer, where the stock fake's
 * structured-output path (which returns a fixed value and ignores messages)
 * cannot capture input.
 */
export class CapturingStructuredChatModel implements StructuredOutputChatModel {
  readonly calls: BaseMessageLike[][] = [];

  constructor(private readonly response: unknown) {}

  withStructuredOutput(): RunnableLambda<BaseLanguageModelInput, unknown> {
    return RunnableLambda.from(async (input: BaseLanguageModelInput) => {
      this.calls.push(Array.isArray(input) ? input : []);
      return this.response;
    });
  }
}

/**
 * A minimal chat model whose structured-output path returns a fixed sequence
 * of values, one per invocation. Used to verify bounded regeneration: a
 * malformed first decision is retried and a later valid one is returned.
 */
export class SequencedStructuredChatModel implements StructuredOutputChatModel {
  private index = 0;
  constructor(private readonly responses: unknown[]) {}

  withStructuredOutput(): RunnableLambda<BaseLanguageModelInput, unknown> {
    return RunnableLambda.from(async () => {
      const value = this.responses[this.index];
      this.index += 1;
      return value;
    });
  }
}

/**
 * A minimal chat model whose structured-output path throws the given error on
 * every invocation, so a realizer generation failure can be exercised end to
 * end without relying on the stock fake's raw-message queue.
 */
export class ThrowingStructuredChatModel implements StructuredOutputChatModel {
  constructor(private readonly error: Error) {}

  withStructuredOutput(): RunnableLambda<BaseLanguageModelInput, unknown> {
    return RunnableLambda.from(async () => {
      throw this.error;
    });
  }
}
