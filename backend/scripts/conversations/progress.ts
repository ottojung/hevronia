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

/**
 * Cumulative progress for a conversation run: finished scenarios over the
 * total, completed rounds over the total expected rounds, and an ETA that
 * linearly extrapolates the observed time per completed round onto the
 * remaining expected rounds. Scenarios run concurrently, so the live line
 * reports only overall progress and never pretends to show a single running
 * scenario.
 */
export class ConversationProgress {
  private readonly totalScenarios: number;
  private readonly totalRounds: number;
  private finished = 0;
  private completedRounds = 0;
  private readonly activeRounds = new Map<string, number>();

  constructor(
    scenarios: readonly ConversationScenario[],
    private readonly startedAt: number = Date.now(),
    private readonly now: () => number = Date.now,
  ) {
    this.totalScenarios = scenarios.length;
    this.totalRounds = totalExpectedRounds(scenarios);
  }

  begin(scenario: ConversationScenario): void {
    this.activeRounds.set(scenario.id, 0);
  }

  advance(scenarioId: string, roundsCompleted: number): void {
    if (this.activeRounds.has(scenarioId)) {
      this.activeRounds.set(scenarioId, roundsCompleted);
    }
  }

  line(): string {
    const completedRounds = this.completedRounds + this.totalActiveRounds();
    return `[${this.finished}/${this.totalScenarios}] ${completedRounds}/${this.totalRounds} rounds — elapsed ${this.elapsed()} — ETA ${this.eta(this.finished, completedRounds)}`;
  }

  finish(scenario: ConversationScenario, result: ScenarioResult): string {
    this.activeRounds.delete(scenario.id);
    this.finished += 1;
    this.completedRounds += result.roundsCompleted;
    const outcome = result.status === "completed"
      ? `done (${result.roundsCompleted}/${scenario.rounds} rounds)`
      : `failed (${result.roundsCompleted}/${scenario.rounds} rounds) — ${result.failure}`;
    return `[${this.finished}/${this.totalScenarios}] ${scenario.id} ${outcome} — ETA ${this.eta(this.finished, this.completedRounds)}`;
  }

  private totalActiveRounds(): number {
    let total = 0;
    for (const rounds of this.activeRounds.values()) total += rounds;
    return total;
  }

  private elapsed(): string {
    return formatElapsed(Math.max(this.now() - this.startedAt, 0));
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
