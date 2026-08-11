import type { ModelSelections } from "./models.js";
import { renderModelSelections } from "./models.js";
import { formatElapsed } from "./progress.js";
import type { RunRecord } from "./transcript.js";

export function renderScenario(record: RunRecord, selections: ModelSelections, revision: string): string {
  const result = record.result;
  const meta = [
    `# ${record.scenario.title}`,
    "",
    `- **ID:** ${record.scenario.id}`,
    `- **Category:** ${record.scenario.category}`,
    `- **Purpose:** ${record.scenario.purpose}`,
    `- **Participant:** ${record.scenario.participantName}`,
    `- **Behavior tags:** ${record.scenario.behaviorTags.join(", ")}`,
  ];
  const memories = record.scenario.longTermMemory;
  if (memories !== undefined && memories.length > 0) {
    meta.push(`- **Long-term memory:** ${memories.join(" · ")}`);
  }
  meta.push(
    `- **Configured rounds:** ${result.scenario.rounds}`,
    `- **Actual rounds:** ${result.roundsCompleted}`,
    `- **Stopping reason:** ${result.status === "completed" ? result.stoppingReason : `failed: ${singleLine(result.failure)}`}`,
    ...renderModelSelections(selections),
    `- **Commit:** ${revision}`,
    "",
    "## Transcript",
    "",
  );
  return meta.join("\n") + renderTranscript(record);
}

function renderTranscript(record: RunRecord): string {
  if (record.lines.length === 0) return "_No transcript was produced._\n";
  const lines = record.lines.slice();
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
  const participantPrefix = `${record.scenario.participantName}: `;
  return lines.map((line) => {
    if (line.startsWith(participantPrefix)) {
      return `**Participant:** ${line.slice(participantPrefix.length)}`;
    }
    if (line.startsWith("Хевронія: ")) {
      return `**Хевронія:** ${line.slice("Хевронія: ".length)}`;
    }
    if (line.startsWith("Планер:")) {
      return `**Планер:**${line.slice("Планер:".length)}`;
    }
    return line;
  }).join("\n") + "\n";
}

function singleLine(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

export function renderIndex(
  records: readonly RunRecord[],
  selections: ModelSelections,
  revision: string,
  durationMs: number,
): string {
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
  return `# Conversation simulation run\n\n- **Commit:** ${revision}\n${renderModelSelections(selections).join("\n")}\n- **Duration:** ${formatElapsed(durationMs)}\n\n${sections.join("\n")}\n`;
}
