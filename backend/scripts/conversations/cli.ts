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
  const selectedIds: readonly string[] = all || (ids.length === 0 && !smoke)
    ? scenarios.map(({ id }) => id)
    : smoke ? smokeScenarioIds
    : ids;
  const selected = selectedIds.map((id) => {
    const scenario = scenarios.find((candidate) => candidate.id === id);
    if (scenario === undefined) throw new ConversationCliError(`Unknown scenario: ${id}`);
    return scenario;
  });
  return { action: "run", scenarios: selected, rounds };
}

export const HELP = `Usage: npm run conversations -- [options] [scenario IDs]

Without arguments, runs every scenario in the catalog.
  --all       Run every scenario in the catalog (same as the default)
  --smoke     Run only the small smoke suite
  --list      List scenarios without API calls
  --rounds N  Override rounds for every selected scenario
  --help      Show this help`;

export function renderScenarioList(): string {
  return scenarios.map(({ id, category, rounds, title }) =>
    `${id}\t${category}\t${rounds}\t${title}`).join("\n");
}
