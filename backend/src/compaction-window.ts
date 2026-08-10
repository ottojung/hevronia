import { type BaseMessage } from "@langchain/core/messages";

/**
 * Cost function for a canonical message slice, used to find the compaction
 * boundary. Callers supply a counter that measures what the models actually
 * consume (for example the dream-rendered representation of the slice).
 */
export type CountSlice = (messages: BaseMessage[]) => Promise<number>;

export async function determineCutoffIndex(
  messages: BaseMessage[],
  keepTokens: number,
  countSlice: CountSlice,
): Promise<number> {
  if (messages.length === 0) return 0;
  if (await countSlice(messages) <= keepTokens) return 0;
  let left = 0;
  let right = messages.length;
  let cutoff = messages.length;
  const maxIterations = Math.floor(Math.log2(messages.length)) + 1;
  for (let index = 0; index < maxIterations; index += 1) {
    if (left >= right) break;
    const mid = Math.floor((left + right) / 2);
    if (await countSlice(messages.slice(mid)) <= keepTokens) {
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

/**
 * The largest non-empty oldest prefix of `messages` whose rendered
 * representation fits within `maxTokens`, or 0 when even the oldest message
 * alone does not fit. Compaction may summarize only this prefix, never a
 * suffix cut away from the beginning of the removable range.
 */
export async function determineSummaryPrefixCount(
  messages: BaseMessage[],
  maxTokens: number,
  countSlice: CountSlice,
): Promise<number> {
  if (messages.length === 0) return 0;
  if (await countSlice(messages.slice(0, 1)) > maxTokens) return 0;
  let low = 1;
  let high = messages.length;
  let best = 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (await countSlice(messages.slice(0, mid)) <= maxTokens) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}
