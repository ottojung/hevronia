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
    await writeFile(join(directory, `${record.scenario.id}.md`), renderScenario(record, simulatorModel));
  }
  await writeFile(join(directory, "index.md"), renderIndex(records, simulatorModel));
}

function renderScenario(record: RunRecord, simulatorModel: string): string {
  const result = record.result;
  const metadata = `# ${record.scenario.title}\n\n- **ID:** ${record.scenario.id}\n- **Category:** ${record.scenario.category}\n- **Purpose:** ${record.scenario.purpose}\n- **Participant:** ${record.scenario.participantName}\n- **Configured rounds:** ${result.scenario.rounds}\n- **Actual rounds:** ${result.roundsCompleted}\n- **Stopping reason:** ${result.status === "completed" ? result.stoppingReason : `failed: ${result.failure}`}\n- **Simulator model:** ${simulatorModel}\n\n## Transcript\n\n`;
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

function renderIndex(records: readonly RunRecord[], simulatorModel: string): string {
  const lines = records.map((record) => {
    const status = record.result.status === "completed" ? "completed" : `failed — ${record.result.failure}`;
    return `- [${record.scenario.id}](./${record.scenario.id}.md) — ${status}`;
  });
  return `# Conversation simulation run\n\nSimulator model: ${simulatorModel}\n\n${lines.join("\n")}\n`;
}
