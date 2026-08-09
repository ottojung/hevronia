import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createConversationLayer } from "../../src/layer.js";
import { parseCli, HELP, renderScenarioList, isConversationCliError } from "./cli.js";
import { EmptyLongTermMemory } from "./empty-long-term-memory.js";
import { errorDetail, runScenario } from "./runner.js";
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
  const records: RunRecord[] = [];
  for (const configuredScenario of command.scenarios) {
    const scenario = command.rounds === undefined
      ? configuredScenario : { ...configuredScenario, rounds: command.rounds };
    console.log("=".repeat(60));
    console.log(`${scenario.id} — ${scenario.title}`);
    console.log("=".repeat(60));
    console.log(`Purpose: ${scenario.purpose}\n`);
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "hevronia-conversation-"));
    try {
      const result = await runScenario(scenario, scenario.rounds, {
        simulator,
        createLayer: () => createConversationLayer({
          dbPath: join(temporaryDirectory, "checkpoints.sqlite"),
          longTermMemory: new EmptyLongTermMemory(),
        }),
        print: console.log,
      });
      records.push({ scenario, result });
      if (result.status === "completed") {
        console.log(`[completed ${result.roundsCompleted}/${scenario.rounds} rounds: ${result.stoppingReason}]\n`);
      } else {
        console.error(`[failed after ${result.roundsCompleted}/${scenario.rounds} rounds: ${result.failure}]\n`);
        process.exitCode = 1;
      }
    } catch (error) {
      const message = errorDetail(error);
      records.push({ scenario, result: failedScenarioResult(scenario, [], 0, message) });
      console.error(`[failed: ${message}]\n`);
      process.exitCode = 1;
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
  const runDirectory = join(CONVERSATION_RUNS_DIR, createRunId());
  await saveRun(runDirectory, records, simulatorModel);
  console.log(`Transcripts saved to ${runDirectory}`);
}

await main();
