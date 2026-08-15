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
    interpretation: "You read this as an ordinary moment with nothing at stake for you.",
    presentMind: {
      primary: "A light ordinary message arrives and nothing in particular grabs you in it.",
      secondary: ["The mention of a shared ordinary moment faintly tugs at the memory of evenings at home."],
    },
    characterIntent: "They are just chatting idly, without any clear purpose toward you.",
    realityCheck: {
      status: "none",
      content: "Nothing in this ordinary moment exposes a grounded difference in how remembered reality works.",
    },
    dreamIntent: "The dream appears to be producing ordinary low-significance social material.",
    feltState: "This leaves you quietly indifferent.",
    activeDesire: {
      strength: "none",
      content: "No actual unsatisfied want arose from this moment.",
    },
    desiredOutcome: "You want the present calm to remain undisturbed.",
    opportunity: "You notice no opportunity here that advances anything you want.",
    fiveTurnStrategy: "Staying silent serves you best for the next several turns.",
    fiftyTurnStrategy: "You want to remain a quiet presence who engages when something genuinely matters.",
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
      primary: "You notice the light casual tone and feel a small impulse to answer in kind.",
      secondary: ["You register that they are still a stranger and hold yourself back."],
    },
    characterIntent: "They want a quick reaction from you.",
    realityCheck: {
      status: "none",
      content: "Nothing in this light exchange exposes a grounded difference in how remembered reality works.",
    },
    dreamIntent: "The dream seems to be maintaining an ordinary, unremarkable interaction.",
    feltState: "This leaves you mildly interested.",
    activeDesire: {
      strength: "weak",
      content: "You want to acknowledge them simply.",
    },
    desiredOutcome: "You want the moment to be acknowledged without fuss.",
    opportunity: "You notice the present interaction gives you room to say a few words.",
    fiveTurnStrategy: "Say something short now and see how it lands.",
    fiftyTurnStrategy: "You are not building anything long-term with this person yet.",
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
