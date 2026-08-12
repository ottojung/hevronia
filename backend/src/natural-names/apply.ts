import type { MissingNaturalNameChoice } from "../planner-schema.js";
import type { NaturalNameStore } from "./store.js";

export interface AppliedNaturalNames {
  /** The canonical name map the realizer should see, including first-write-wins results. */
  merged: ReadonlyMap<number, string>;
  /** handle → resolved name for the names assigned on this turn. */
  newNames: Record<string, string>;
}

/**
 * Persists every proposed natural name with first-write-wins semantics and
 * interprets the planner's `null` answers: a `null` alias falls back to the
 * person's exact `@username` when one exists, and leaves the person unnamed
 * (character X) when there is no username. Returns the merged name map the
 * realizer should see, including any name a concurrent proposal stored first.
 *
 * The optional `guard` is checked before every durable `assignIfAbsent`, so a
 * stale or cancelled reaction cannot begin further naming writes once
 * invalidation is observable. An assignment that atomically completed before
 * the guard fired is accepted; nothing is rolled back.
 */
export async function applyProposedNames(
  store: NaturalNameStore,
  choices: readonly MissingNaturalNameChoice[],
  proposed: Readonly<Record<string, string | null>>,
  existing: ReadonlyMap<number, string>,
  guard: () => void = () => undefined,
): Promise<AppliedNaturalNames> {
  const merged = new Map(existing);
  const newNames: Record<string, string> = {};
  for (const choice of choices) {
    guard();
    const resolved = resolveProposedName(choice, proposed[choice.handle]);
    if (resolved === undefined) continue;
    merged.set(choice.sender.id, await store.assignIfAbsent(choice.sender.id, resolved));
    newNames[choice.handle] = resolved;
  }
  return { merged, newNames };
}

function resolveProposedName(
  choice: MissingNaturalNameChoice,
  value: string | null | undefined,
): string | undefined {
  if (value !== null && value !== undefined) return value;
  if (choice.username !== null && choice.username !== "") return `@${choice.username}`;
  return undefined;
}
