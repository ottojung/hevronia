import { HumanMessage, RemoveMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { v4 as uuid } from "@langchain/core/utils/uuid";
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph";
import type { TokenCounter } from "langchain";

import { determineCutoffIndex, trimForSummary } from "./compaction-window.js";
import { renderDreamObservations } from "./dream-render.js";
import { SUMMARY_PREFIX, SUMMARY_PROMPT } from "./summary.js";

/**
 * Compacts the conversation when it exceeds the trigger budget. Older messages
 * are rendered through the dream renderer before the summary model sees them,
 * so internal canonical JSON and message IDs never reach a language model.
 */
export async function compactIfNeeded(
  state: { messages: BaseMessage[] },
  summaryModel: BaseLanguageModel,
  triggerTokens: number,
  keepTokens: number,
  trimTokensToSummarize: number,
  tokenCounter: TokenCounter,
): Promise<{ messages?: BaseMessage[] }> {
  const messages = state.messages;
  if (await tokenCounter(messages) < triggerTokens) return {};
  const cutoffIndex = await determineCutoffIndex(messages, keepTokens, tokenCounter);
  if (cutoffIndex <= 0) return {};
  const messagesToSummarize = messages.slice(0, cutoffIndex);
  const preservedMessages = messages.slice(cutoffIndex);
  const summaryMessage = new HumanMessage({
    content: `${SUMMARY_PREFIX}\n\n${await createSummary(
      messagesToSummarize, summaryModel, trimTokensToSummarize, tokenCounter,
    )}`,
    id: uuid(),
    additional_kwargs: { lc_source: "summarization" },
  });
  return {
    messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), summaryMessage, ...preservedMessages],
  };
}

async function createSummary(
  messages: BaseMessage[],
  model: BaseLanguageModel,
  trimTokensToSummarize: number,
  tokenCounter: TokenCounter,
): Promise<string> {
  const trimmed = await trimForSummary(messages, trimTokensToSummarize, tokenCounter);
  if (trimmed.length === 0) return "No previous conversation history.";
  const formattedPrompt = SUMMARY_PROMPT.replace("{messages}", renderDreamObservations(trimmed));
  try {
    const content = (await model.invoke(formattedPrompt)).content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      return content.map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null && "text" in item) return item.text;
        return "";
      }).join("").trim();
    }
    return "Error generating summary: Invalid response format";
  } catch (error) {
    return `Error generating summary: ${String(error)}`;
  }
}
