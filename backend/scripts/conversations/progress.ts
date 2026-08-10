import type { ConversationScenario, ScenarioResult } from "./types.js";

export function totalExpectedRounds(scenarios: readonly ConversationScenario[]): number {
  return scenarios.reduce((sum, scenario) => sum + scenario.rounds, 0);
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

interface ActiveScenario {
  scenario: ConversationScenario;
  rounds: number;
}

/**
 * Cumulative progress for a conversation run: finished scenarios over the
 * total, the currently running scenario and its completed rounds, and an ETA
 * that linearly extrapolates the observed time per completed round onto the
 * remaining expected rounds. Progress stays live because the running
 * scenario's rounds are tracked as they happen and the elapsed time is read
 * on every render, so re-rendering the line keeps the ETA current.
 */
export class ConversationProgress {
  private readonly totalScenarios: number;
  private readonly totalRounds: number;
  private finished = 0;
  private completedRounds = 0;
  private readonly active = new Map<string, ActiveScenario>();
  private displayScenario: ConversationScenario | undefined;

  constructor(
    scenarios: readonly ConversationScenario[],
    private readonly startedAt: number = Date.now(),
    private readonly now: () => number = Date.now,
  ) {
    this.totalScenarios = scenarios.length;
    this.totalRounds = totalExpectedRounds(scenarios);
  }

  begin(scenario: ConversationScenario): void {
    this.active.set(scenario.id, { scenario, rounds: 0 });
    this.displayScenario = scenario;
  }

  advance(scenarioId: string, roundsCompleted: number): void {
    const entry = this.active.get(scenarioId);
    if (entry !== undefined) entry.rounds = roundsCompleted;
  }

  line(): string {
    const prefix = `[${this.finished}/${this.totalScenarios}]`;
    const active = this.displayScenario === undefined ? "" : this.activeRoundsText(this.displayScenario);
    const activeRounds = this.totalActiveRounds();
    return `${prefix}${active} — ETA ${this.eta(this.finished, this.completedRounds + activeRounds)}`;
  }

  finish(scenario: ConversationScenario, result: ScenarioResult): string {
    this.active.delete(scenario.id);
    if (this.displayScenario?.id === scenario.id) this.displayScenario = undefined;
    this.finished += 1;
    this.completedRounds += result.roundsCompleted;
    const outcome = result.status === "completed"
      ? `done (${result.roundsCompleted}/${scenario.rounds} rounds)`
      : `failed (${result.roundsCompleted}/${scenario.rounds} rounds) — ${result.failure}`;
    return `[${this.finished}/${this.totalScenarios}] ${scenario.id} ${outcome} — ETA ${this.eta(this.finished, this.completedRounds)}`;
  }

  private activeRoundsText(scenario: ConversationScenario): string {
    const rounds = this.active.get(scenario.id)?.rounds ?? 0;
    return ` ${scenario.id} ${rounds}/${scenario.rounds} rounds`;
  }

  private totalActiveRounds(): number {
    let total = 0;
    for (const entry of this.active.values()) total += entry.rounds;
    return total;
  }

  private eta(finished: number, completedRounds: number): string {
    if (finished >= this.totalScenarios) return "~0s";
    const remainingRounds = Math.max(this.totalRounds - completedRounds, 0);
    if (remainingRounds === 0) return "~0s";
    if (completedRounds <= 0) return "~?";
    const elapsed = Math.max(this.now() - this.startedAt, 0);
    return `~${formatElapsed((elapsed / completedRounds) * remainingRounds)}`;
  }
}
