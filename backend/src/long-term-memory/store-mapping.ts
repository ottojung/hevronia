export interface MemoryRecord {
  id: string;
  text: string;
  score?: number;
}

function isMemoryItemLike(value: unknown): value is { id: unknown; memory: unknown; score?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  return "id" in value && "memory" in value;
}

/**
 * Maps raw Mem0 result items into `MemoryRecord` values, keeping the persistent
 * memory ID and relevance score when present. Malformed entries are skipped
 * rather than poisoning the in-process cache.
 */
export function memoryRecordsFromItems(items: readonly unknown[]): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  for (const item of items) {
    if (!isMemoryItemLike(item)) continue;
    if (typeof item.id !== "string" || typeof item.memory !== "string") continue;
    records.push({
      id: item.id,
      text: item.memory,
      score: typeof item.score === "number" ? item.score : undefined,
    });
  }
  return records;
}
