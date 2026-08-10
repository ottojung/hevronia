import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { parseCli, HELP, renderScenarioList, isConversationCliError } from "./cli.js";
import { runScenariosConcurrently, runScenariosSequentially } from "./orchestrator.js";
import { ConversationProgress } from "./progress.js";
import { completionLine, runScenarioEntry, scenarioHeaderLines } from "./scenario-execution.js";
import { createSimulator, DEFAULT_SIMULATOR_MODEL } from "./simulator.js";
import { createRunId, saveRun, type RunRecord } from "./transcript.js";
import { failedScenarioResult } from "./types.js";

const CONVERSATION_RUNS_DIR = fileURLToPath(
  new URL("../../.data/conversation-runs", import.meta.url),
);

async function main(): Promise<void> {
  let command;
  try {
    command = parseCli(process.argv.slice(2));
  } catch (error) {
    console.error(isConversationCliError(error) ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if (command.action === "help") { console.log(HELP); return; }
  if (command.action === "list") { console.log(renderScenarioList()); return; }

  const simulatorModel = process.env["HEVRONIA_SIMULATOR_MODEL"] ?? DEFAULT_SIMULATOR_MODEL;
  const simulator = createSimulator(simulatorModel);
  const buffers = new Map<string, string[]>();
  for (const scenario of command.scenarios) {
    buffers.set(scenario.id, scenarioHeaderLines(scenario));
  }
  const progress = new ConversationProgress(command.scenarios);
  const runScenarios = command.parallel
    ? runScenariosConcurrently
    : runScenariosSequentially;
  const results = await runScenarios(command.scenarios, async (scenario) => {
    console.log(`[start] ${scenario.id}`);
    const lines = buffers.get(scenario.id) ?? [];
    const result = await runScenarioEntry(scenario, simulator, lines);
    lines.push(completionLine(scenario, result));
    console.log(progress.finish(scenario, result));
    return result;
  });
  const records: RunRecord[] = command.scenarios.map((scenario, index) => {
    const result = results[index] ??
      failedScenarioResult(scenario, [], 0, "scenario produced no outcome");
    if (result.status === "failed") process.exitCode = 1;
    return { scenario, result };
  });
  for (const record of records) {
    const lines = buffers.get(record.scenario.id) ?? [];
    console.log(lines.join("\n"));
  }
  const runDirectory = join(CONVERSATION_RUNS_DIR, createRunId());
  await saveRun(runDirectory, records, simulatorModel);
  console.log(`Transcripts saved to ${runDirectory}`);
}

await main();
