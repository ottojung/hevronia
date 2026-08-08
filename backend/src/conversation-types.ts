import type { BaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { TokenCounter } from "langchain";

import type { LongTermMemory } from "./long-term-memory/index.js";
import type { GeneratedTurn } from "./generated-turn.js";
import type { PendingMemoryWrites } from "./long-term-memory/pending.js";
import type { ConversationThreadId, LongTermMemoryUserId } from "./identifiers.js";
import type { ObservedTelegramMessage } from "./telegram-event.js";

export interface RespondInput {
  threadId: ConversationThreadId;
  userId: LongTermMemoryUserId;
  message: ObservedTelegramMessage;
  hevroniaSenderId: number;
}

export interface ConversationLayerOptions {
  dbPath?: string;
  model?: BaseLanguageModel;
  summaryModel?: BaseLanguageModel;
  systemPrompt?: string;
  triggerTokens?: number;
  keepTokens?: number;
  trimTokensToSummarize?: number;
  tokenCounter?: TokenCounter;
  longTermMemory?: LongTermMemory;
  pendingMemoryWrites?: PendingMemoryWrites;
  decisionMaker?: import("./social-decision.js").SocialDecisionMaker;
}

export interface ConversationLayer {
  respond(input: RespondInput): Promise<GeneratedTurn>;
  getMessages(threadId: ConversationThreadId): Promise<BaseMessage[]>;
  close(): Promise<void>;
}
