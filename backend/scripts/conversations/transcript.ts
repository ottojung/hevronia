import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ConversationScenario, ScenarioResult, TranscriptEntry } from "./types.js";

export interface RunRecord {
  scenario: ConversationScenario;
  result: ScenarioResult;
}

export function createRunId(date = new Date()): string {
  return date.toISOString().replaceAll(":", "-").replace(".", "-");
}

export async function saveRun(
  directory: string,
  records: readonly RunRecord[],
  simulatorModel: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const record of records) {
    try {
      await writeFile(join(directory, `${record.scenario.id}.md`), renderScenario(record, simulatorModel));
    } catch (error) {
      console.warn(`Failed to save transcript for ${record.scenario.id}: ${String(error)}`);
    }
  }
  try {
    await writeFile(join(directory, "index.md"), renderIndex(records, simulatorModel));
  } catch (error) {
    console.warn(`Failed to save the run index: ${String(error)}`);
  }
}

function renderScenario(record: RunRecord, simulatorModel: string): string {
  const result = record.result;
  const metadata = `# ${record.scenario.title}\n\n- **ID:** ${record.scenario.id}\n- **Category:** ${record.scenario.category}\n- **Purpose:** ${record.scenario.purpose}\n- **Participant:** ${record.scenario.participantName}\n- **Behavior tags:** ${record.scenario.behaviorTags.join(", ")}\n- **Configured rounds:** ${result.scenario.rounds}\n- **Actual rounds:** ${result.roundsCompleted}\n- **Stopping reason:** ${result.status === "completed" ? result.stoppingReason : `failed: ${singleLine(result.failure)}`}\n- **Simulator model:** ${simulatorModel}\n\n## Transcript\n\n`;
  const transcript = result.transcript.length === 0
    ? "_No transcript was produced._\n"
    : renderEntries(result.transcript);
  return metadata + transcript;
}

function renderEntries(entries: readonly TranscriptEntry[]): string {
  return entries.map((entry) => {
    if (entry.speaker === "participant") return `**Participant:** ${entry.text}`;
    if ("silence" in entry) return "**Хевронія:** [silence]";
    return `**Хевронія:** ${entry.text}`;
  }).join("\n\n") + "\n";
}

function singleLine(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

function renderIndex(records: readonly RunRecord[], simulatorModel: string): string {
  const categories = [...new Set(records.map((record) => record.scenario.category))];
  const sections = categories.map((category) => {
    const rows = records.filter((record) => record.scenario.category === category).map((record) => {
      const status = record.result.status === "completed"
        ? "completed"
        : `failed — ${singleLine(record.result.failure)}`;
      const rounds = `${record.result.roundsCompleted}/${record.result.scenario.rounds}`;
      const tags = record.scenario.behaviorTags.join(", ");
      return `| [${record.scenario.title}](./${record.scenario.id}.md) | ${record.scenario.id} | ${status} | ${rounds} | ${tags} |`;
    }).join("\n");
    return `## ${category}\n\n| Scenario | ID | Status | Rounds | Behavior tags |\n|---|---|---|---|---|\n${rows}\n`;
  });
  return `# Conversation simulation run\n\nSimulator model: ${simulatorModel}\n\n${sections.join("\n")}\n`;
}
