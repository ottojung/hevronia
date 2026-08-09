import { HumanMessage, RemoveMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { v4 as uuid } from "@langchain/core/utils/uuid";
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph";

import { determineCutoffIndex, determineSummaryPrefixCount, type CountSlice } from "./compaction-window.js";
import { renderDreamObservations } from "./dream-render.js";
import { SUMMARY_PREFIX, SUMMARY_PROMPT } from "./summary.js";

/**
 * Compacts the conversation when it exceeds the trigger budget. The oldest
 * prefix that fits the summary-input budget is rendered through the dream
 * renderer and given to the summary model; exactly that prefix is removed on
 * success, so every removed message participated in the summary input.
 * A failed summary attempt is non-destructive: the existing messages stay.
 */
export async function compactIfNeeded(
  state: { messages: BaseMessage[] },
  summaryModel: BaseLanguageModel,
  triggerTokens: number,
  keepTokens: number,
  trimTokensToSummarize: number,
  countSlice: CountSlice,
): Promise<{ messages?: BaseMessage[] }> {
  const messages = state.messages;
  if (await countSlice(messages) < triggerTokens) return {};
  const desiredCutoff = await determineCutoffIndex(messages, keepTokens, countSlice);
  if (desiredCutoff <= 0) return {};
  const removable = messages.slice(0, desiredCutoff);
  const summaryCount = await determineSummaryPrefixCount(
    removable, trimTokensToSummarize, countSlice,
  );
  if (summaryCount <= 0) return {};
  const messagesToSummarize = removable.slice(0, summaryCount);
  const preservedMessages = messages.slice(summaryCount);
  const summary = await createSummary(messagesToSummarize, summaryModel);
  if (summary === undefined) return {};
  const summaryMessage = new HumanMessage({
    content: `${SUMMARY_PREFIX}\n\n${summary}`,
    id: uuid(),
    additional_kwargs: { lc_source: "summarization" },
  });
  return {
    messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), summaryMessage, ...preservedMessages],
  };
}

/**
 * Produces the summary text, or signals failure by returning undefined. A
 * throwing, empty, whitespace-only, or unsupported response never becomes
 * summary content and never replaces the source history.
 */
async function createSummary(
  messages: BaseMessage[],
  model: BaseLanguageModel,
): Promise<string | undefined> {
  try {
    // Callback replacement so verbatim Telegram text (including "$&", "$'",
    // "$`", "$$") is inserted literally rather than as a replacement pattern.
    const formattedPrompt = SUMMARY_PROMPT.replace(
      "{messages}", () => renderDreamObservations(messages),
    );
    const content = (await model.invoke(formattedPrompt)).content;
    if (typeof content === "string") return trimmedText(content);
    if (Array.isArray(content)) {
      return trimmedText(content.map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null && "text" in item) return item.text;
        return "";
      }).join(""));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function trimmedText(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
