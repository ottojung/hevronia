import { createAgent, summarizationMiddleware, type TokenCounter } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SYSTEM_PROMPT } from "./personality.js";

export const MODEL = "gpt-4o-mini";

export const COMPACTION = {
  triggerTokens: 12_000,
  keepTokens: 4_000,
  trimTokensToSummarize: 10_000,
} as const;

const DEFAULT_DB_PATH = fileURLToPath(
  new URL("../.data/checkpoints.sqlite", import.meta.url),
);

export const SUMMARY_PREFIX =
  "Earlier conversation summary. Newer verbatim messages take precedence if they conflict:";

export const SUMMARY_PROMPT = `Create a compact continuity summary of the earlier portion of this Telegram conversation for use as context in future turns.

Preserve information that may matter later:

- concrete facts established by either participant;
- names and relationships;
- preferences, dislikes, habits, and boundaries;
- plans, promises, decisions, and intentions;
- unresolved questions and unfinished topics;
- important emotional context;
- corrections the user made to earlier assumptions;
- meaningful opinions or positions;
- recurring jokes, references, or conversational context that would otherwise become confusing;
- important facts established about Хевронія within the conversation.

Compress aggressively:

- remove greetings, filler, repetitions, and small talk with no future value;
- do not summarize generic explanations unless later turns depend on them;
- merge repeated information;
- prefer concise factual bullets over narrative;
- preserve uncertainty as uncertainty;
- if newer information supersedes older information, retain the newer state;
- never invent facts or infer facts that were not actually established;
- distinguish hypothetical statements from actual facts;
- retain exact wording only when the wording itself matters.

The summary is internal memory, not a message written by either participant. Do not imitate either participant's voice.

Conversation to compact:

{messages}`;

export function openAiKeyFromEnv(): string {
  const apiKey = process.env.MY_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "MY_OPENAI_API_KEY is not set in the environment. " +
        "Provide the OpenAI API key before starting the bot.",
    );
  }
  return apiKey;
}

export function extractText(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  let text = "";
  for (const block of content) {
    if ("type" in block && block.type === "text") {
      text += block.text;
    }
  }
  return text;
}

export function extractReplyText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message instanceof AIMessage) {
      const text = extractText(message.content).trim();
      if (text) {
        return text;
      }
    }
  }
  throw new Error("Agent returned no text reply");
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
}

export interface ConversationLayer {
  respond(threadId: string, messageText: string): Promise<string>;
  getMessages(threadId: string): Promise<BaseMessage[]>;
  close(): Promise<void>;
}

export function createConversationLayer(options: ConversationLayerOptions = {}): ConversationLayer {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const systemPrompt = options.systemPrompt ?? SYSTEM_PROMPT;
  const triggerTokens = options.triggerTokens ?? COMPACTION.triggerTokens;
  const keepTokens = options.keepTokens ?? COMPACTION.keepTokens;
  const trimTokensToSummarize =
    options.trimTokensToSummarize ?? COMPACTION.trimTokensToSummarize;

  mkdirSync(dirname(dbPath), { recursive: true });
  const checkpointer = SqliteSaver.fromConnString(dbPath);
  console.log(`Conversation memory initialized; checkpoint database opened: ${dbPath}`);
  console.log(
    `Compaction configuration loaded: trigger=${triggerTokens} tokens, keep=${keepTokens} tokens, trim=${trimTokensToSummarize} tokens`,
  );

  const model =
    options.model ??
    new ChatOpenAI({
      apiKey: openAiKeyFromEnv(),
      model: MODEL,
      temperature: 0.9,
    });
  const summaryModel =
    options.summaryModel ??
    new ChatOpenAI({
      apiKey: openAiKeyFromEnv(),
      model: MODEL,
      temperature: 0,
    });

  const agent = createAgent({
    model,
    tools: [],
    systemPrompt,
    checkpointer,
    middleware: [
      summarizationMiddleware({
        model: summaryModel,
        trigger: { tokens: triggerTokens },
        keep: { tokens: keepTokens },
        trimTokensToSummarize,
        summaryPrefix: SUMMARY_PREFIX,
        summaryPrompt: SUMMARY_PROMPT,
        tokenCounter: options.tokenCounter,
      }),
    ],
  });

  return {
    async respond(threadId: string, messageText: string): Promise<string> {
      const result = await agent.invoke(
        { messages: [new HumanMessage(messageText)] },
        { configurable: { thread_id: threadId } },
      );
      return extractReplyText(result.messages);
    },
    async getMessages(threadId: string): Promise<BaseMessage[]> {
      const tuple = await checkpointer.getTuple({ configurable: { thread_id: threadId } });
      const messages = tuple?.checkpoint.channel_values.messages;
      return (Array.isArray(messages) ? messages : []) as BaseMessage[];
    },
    async close(): Promise<void> {
      checkpointer.db.close();
    },
  };
}

let sharedLayer: ConversationLayer | undefined;

export function getConversationLayer(): ConversationLayer {
  sharedLayer ??= createConversationLayer();
  return sharedLayer;
}

export async function closeConversationLayer(): Promise<void> {
  if (sharedLayer !== undefined) {
    const layer = sharedLayer;
    sharedLayer = undefined;
    await layer.close();
  }
}
