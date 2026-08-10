import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createConversationLayer } from "../../src/layer.js";
import type { LazyLongTermMemory } from "../../src/long-term-memory/runtime.js";
import { PreseededLazyMemory } from "./preseeded-lazy-memory.js";
import { errorDetail, runScenario } from "./runner.js";
import { failedScenarioResult } from "./types.js";
import type { ConversationScenario, ScenarioResult, Simulator } from "./types.js";

function createScenarioMemory(scenario: ConversationScenario): LazyLongTermMemory {
  return new PreseededLazyMemory(scenario.longTermMemory ?? []);
}

export async function runScenarioEntry(
  scenario: ConversationScenario,
  simulator: Simulator,
  lines: string[],
): Promise<ScenarioResult> {
  let temporaryDirectory: string | undefined;
  try {
    const directory = await mkdtemp(join(tmpdir(), "hevronia-conversation-"));
    temporaryDirectory = directory;
    const result = await runScenario(scenario, scenario.rounds, {
      simulator,
      createLayer: () => createConversationLayer({
        dbPath: join(directory, "checkpoints.sqlite"),
        lazyMemory: createScenarioMemory(scenario),
      }),
      print: (line) => lines.push(line),
    });
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      return failedScenarioResult(scenario, result.transcript, result.roundsCompleted,
        `temporary directory cleanup failed: ${errorDetail(error)}`);
    }
    return result;
  } catch (error) {
    if (temporaryDirectory !== undefined) {
      try { await rm(temporaryDirectory, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    return failedScenarioResult(scenario, [], 0, errorDetail(error));
  }
}

export function scenarioHeaderLines(scenario: ConversationScenario): string[] {
  const lines = [
    "=".repeat(60),
    `${scenario.id} — ${scenario.title}`,
    "=".repeat(60),
    `Purpose: ${scenario.purpose}`,
    "",
  ];
  const memories = scenario.longTermMemory;
  if (memories !== undefined && memories.length > 0) {
    lines.push("Long-term memory about this character:");
    for (const fact of memories) {
      lines.push(`- ${fact}`);
    }
    lines.push("");
  }
  return lines;
}

export function completionLine(scenario: ConversationScenario, result: ScenarioResult): string {
  return result.status === "completed"
    ? `[completed ${result.roundsCompleted}/${scenario.rounds} rounds: ${result.stoppingReason}]`
    : `[failed after ${result.roundsCompleted}/${scenario.rounds} rounds: ${result.failure}]`;
}
