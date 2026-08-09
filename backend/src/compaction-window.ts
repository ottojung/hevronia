import { type BaseMessage } from "@langchain/core/messages";

import type { TokenCounter } from "langchain";

export async function determineCutoffIndex(
  messages: BaseMessage[],
  keepTokens: number,
  tokenCounter: TokenCounter,
): Promise<number> {
  if (messages.length === 0) return 0;
  if (await tokenCounter(messages) <= keepTokens) return 0;
  let left = 0;
  let right = messages.length;
  let cutoff = messages.length;
  const maxIterations = Math.floor(Math.log2(messages.length)) + 1;
  for (let index = 0; index < maxIterations; index += 1) {
    if (left >= right) break;
    const mid = Math.floor((left + right) / 2);
    if (await tokenCounter(messages.slice(mid)) <= keepTokens) {
      cutoff = mid;
      right = mid;
    } else {
      left = mid + 1;
    }
  }
  if (cutoff === messages.length) cutoff = left;
  if (cutoff >= messages.length) {
    if (messages.length === 1) return 0;
    cutoff = messages.length - 1;
  }
  return cutoff;
}

export async function trimForSummary(
  messages: BaseMessage[],
  trimTokensToSummarize: number,
  tokenCounter: TokenCounter,
): Promise<BaseMessage[]> {
  try {
    if (await tokenCounter(messages) <= trimTokensToSummarize) return messages;
    let left = 0;
    let right = messages.length;
    let cutoff = messages.length;
    const maxIterations = Math.floor(Math.log2(messages.length)) + 1;
    for (let index = 0; index < maxIterations; index += 1) {
      if (left >= right) break;
      const mid = Math.floor((left + right) / 2);
      if (await tokenCounter(messages.slice(mid)) <= trimTokensToSummarize) {
        cutoff = mid;
        right = mid;
      } else {
        left = mid + 1;
      }
    }
    if (cutoff === messages.length) cutoff = left;
    if (cutoff >= messages.length) cutoff = messages.length - 1;
    return messages.slice(Math.max(cutoff, 0));
  } catch {
    return messages.slice(-15);
  }
}
