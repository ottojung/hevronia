import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ModelSelections } from "./models.js";
import { renderIndex, renderScenario } from "./transcript-render.js";
import type { ConversationScenario, ScenarioResult } from "./types.js";

export interface RunRecord {
  scenario: ConversationScenario;
  result: ScenarioResult;
  /** The printed conversation block including planner decisions. */
  lines: string[];
}

export function createRunId(date = new Date(), revision?: string): string {
  const base = date.toISOString().replaceAll(":", "-").replace(".", "-");
  return revision === undefined ? base : `${base}-${revision}`;
}

export async function saveRun(
  directory: string,
  records: readonly RunRecord[],
  selections: ModelSelections,
  revision: string,
  durationMs: number,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const record of records) {
    try {
      await writeFile(join(directory, `${record.scenario.id}.md`),
        renderScenario(record, selections, revision));
    } catch (error) {
      console.warn(`Failed to save transcript for ${record.scenario.id}: ${String(error)}`);
    }
  }
  try {
    await writeFile(join(directory, "index.md"),
      renderIndex(records, selections, revision, durationMs));
  } catch (error) {
    console.warn(`Failed to save the run index: ${String(error)}`);
  }
}
