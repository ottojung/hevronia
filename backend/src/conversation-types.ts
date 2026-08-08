import type { BaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { TokenCounter } from "langchain";

import type { LongTermMemory } from "./long-term-memory/index.js";

export interface RespondInput {
  threadId: string;
  userId: string;
  messageText: string;
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
}

export interface ConversationLayer {
  respond(input: RespondInput): Promise<string>;
  getMessages(threadId: string): Promise<BaseMessage[]>;
  close(): Promise<void>;
}
