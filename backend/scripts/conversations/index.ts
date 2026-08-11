import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { parseCli, HELP, renderScenarioList, isConversationCliError } from "./cli.js";
import { formatGitRevision, gitRevision } from "./git.js";
import { runScenariosConcurrently } from "./orchestrator.js";
import { LiveProgressRenderer } from "./progress-output.js";
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
  const revision = formatGitRevision(gitRevision());
  console.log(`Run commit: ${revision}`);
  const buffers = new Map<string, string[]>();
  for (const scenario of command.scenarios) {
    buffers.set(scenario.id, scenarioHeaderLines(scenario));
  }
  const progress = new ConversationProgress(command.scenarios);
  const renderer = new LiveProgressRenderer(progress);
  renderer.start();
  try {
    const results = await runScenariosConcurrently(command.scenarios, async (scenario) => {
      progress.begin(scenario);
      console.log(`[start] ${scenario.id}`);
      const lines = buffers.get(scenario.id) ?? [];
      const result = await runScenarioEntry(scenario, simulator, lines, (roundsCompleted) => {
        progress.advance(scenario.id, roundsCompleted);
        renderer.render();
      });
      lines.push(completionLine(scenario, result));
      renderer.commit(progress.finish(scenario, result));
      return result;
    });
    renderer.stop();
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
    const runDirectory = join(CONVERSATION_RUNS_DIR, createRunId(new Date(), revision));
    await saveRun(runDirectory, records, simulatorModel, revision);
    console.log(`Transcripts saved to ${runDirectory}`);
  } finally {
    renderer.stop();
  }
}

await main();
