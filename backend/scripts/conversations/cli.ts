import { scenarios, smokeScenarioIds } from "./catalog.js";
import type { ConversationScenario } from "./types.js";

export type CliCommand =
  | { action: "help" }
  | { action: "list" }
  | { action: "run"; scenarios: ConversationScenario[]; rounds: number | undefined };

export class ConversationCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationCliError";
  }
}

export function isConversationCliError(error: unknown): error is ConversationCliError {
  return error instanceof ConversationCliError;
}

export function parseCli(arguments_: readonly string[]): CliCommand {
  let all = false;
  let smoke = false;
  let rounds: number | undefined;
  const ids: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;
    if (argument === "--help") return { action: "help" };
    if (argument === "--list") return { action: "list" };
    if (argument === "--all") { all = true; continue; }
    if (argument === "--smoke") { smoke = true; continue; }
    if (argument === "--rounds") {
      const value = arguments_[index + 1];
      const parsed = Number(value);
      if (value === undefined || !/^[1-9]\d*$/u.test(value) ||
          !Number.isSafeInteger(parsed) || String(parsed) !== value) {
        throw new ConversationCliError("--rounds requires a positive safe integer");
      }
      rounds = parsed;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) throw new ConversationCliError(`Unknown option: ${argument}`);
    ids.push(argument);
  }
  if (all && smoke) {
    throw new ConversationCliError("--all cannot be combined with --smoke");
  }
  if ((all || smoke) && ids.length > 0) {
    throw new ConversationCliError("--all/--smoke cannot be combined with scenario IDs");
  }
  const selectedIds: readonly string[] = all
    ? scenarios.map(({ id }) => id)
    : smoke || ids.length === 0 ? smokeScenarioIds
    : ids;
  const selected = selectedIds.map((id) => {
    const scenario = scenarios.find((candidate) => candidate.id === id);
    if (scenario === undefined) throw new ConversationCliError(`Unknown scenario: ${id}`);
    return withRoundsOverride(scenario, rounds);
  });
  return { action: "run", scenarios: selected, rounds };
}

// `--rounds` overrides the catalog default for every selected scenario. The
// override is applied to the scenario object itself so that the runner, the
// progress line, and the completion line all agree on the effective round
// count without threading a separate parameter through the run.
function withRoundsOverride(
  scenario: ConversationScenario,
  override: number | undefined,
): ConversationScenario {
  return override === undefined ? scenario : { ...scenario, rounds: override };
}

export const HELP = `Usage: npm run conversations -- [options] [scenario IDs]

Without arguments, runs the small smoke suite.
  --all       Run every scenario in the catalog
  --smoke     Run the small smoke suite (same as the default)
  --list      List scenarios without API calls
  --rounds N  Override rounds for every selected scenario
  --help      Show this help`;

export function renderScenarioList(): string {
  return scenarios.map(({ id, category, rounds, title }) =>
    `${id}\t${category}\t${rounds}\t${title}`).join("\n");
}
