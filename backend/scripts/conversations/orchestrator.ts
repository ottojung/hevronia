import { failedScenarioResult } from "./types.js";
import type { ConversationScenario, ScenarioResult } from "./types.js";

export async function runScenariosSequentially(
  scenarios: readonly ConversationScenario[],
  execute: (scenario: ConversationScenario) => Promise<ScenarioResult>,
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    let result: ScenarioResult;
    try {
      result = await execute(scenario);
    } catch (error) {
      result = failedScenarioResult(scenario, [], 0, failureDetail(error));
    }
    results.push(result);
  }
  return results;
}

export async function runScenariosConcurrently(
  scenarios: readonly ConversationScenario[],
  execute: (scenario: ConversationScenario) => Promise<ScenarioResult>,
): Promise<ScenarioResult[]> {
  const entries = scenarios.map((scenario) => {
    let task: Promise<ScenarioResult>;
    try {
      task = execute(scenario);
    } catch (error) {
      task = Promise.reject(error);
    }
    return { scenario, task };
  });
  const outcomes = await Promise.allSettled(entries.map(({ task }) => task));
  return entries.map(({ scenario }, index) => {
    const outcome = outcomes[index];
    if (outcome === undefined) {
      return failedScenarioResult(scenario, [], 0, "scenario produced no outcome");
    }
    if (outcome.status === "fulfilled") return outcome.value;
    return failedScenarioResult(scenario, [], 0, failureDetail(outcome.reason));
  });
}

function failureDetail(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.replaceAll(/\s+/gu, " ").trim();
}
