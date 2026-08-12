import type { MissingNaturalNameChoice } from "../planner-schema.js";
import type { NaturalNameStore } from "./store.js";

/**
 * Persists every proposed natural name with first-write-wins semantics and
 * returns the merged name map the realizer should see, including any name a
 * concurrent proposal stored first.
 */
export async function applyProposedNames(
  store: NaturalNameStore,
  choices: readonly MissingNaturalNameChoice[],
  proposed: Readonly<Record<string, string>>,
  existing: ReadonlyMap<number, string>,
): Promise<ReadonlyMap<number, string>> {
  const merged = new Map(existing);
  for (const choice of choices) {
    const name = proposed[choice.handle];
    if (name === undefined) continue;
    merged.set(choice.sender.id, await store.assignIfAbsent(choice.sender.id, name));
  }
  return merged;
}
