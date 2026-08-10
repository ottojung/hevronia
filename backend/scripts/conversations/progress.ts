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
 * total, and an ETA that linearly extrapolates the observed time per expected
 * round onto the remaining expected rounds. Each finished scenario counts its
 * full expected round count, so the completed tally always reaches the total
 * and the ETA converges to zero when the run ends.
 */
export class ConversationProgress {
  private readonly totalScenarios: number;
  private readonly totalRounds: number;
  private finished = 0;
  private completedRounds = 0;

  constructor(
    scenarios: readonly ConversationScenario[],
    private readonly startedAt: number = Date.now(),
    private readonly now: () => number = Date.now,
  ) {
    this.totalScenarios = scenarios.length;
    this.totalRounds = totalExpectedRounds(scenarios);
  }

  finish(scenario: ConversationScenario, result: ScenarioResult): string {
    this.finished += 1;
    this.completedRounds += scenario.rounds;
    const outcome = result.status === "completed"
      ? `done (${result.roundsCompleted}/${scenario.rounds} rounds)`
      : `failed (${result.roundsCompleted}/${scenario.rounds} rounds) — ${result.failure}`;
    return `[${this.finished}/${this.totalScenarios}] ${scenario.id} ${outcome} — ETA ${this.renderEta()}`;
  }

  private renderEta(): string {
    const remainingRounds = Math.max(this.totalRounds - this.completedRounds, 0);
    if (remainingRounds === 0) return "~0s";
    if (this.completedRounds <= 0) return "~?";
    const elapsed = Math.max(this.now() - this.startedAt, 0);
    const etaMs = (elapsed / this.completedRounds) * remainingRounds;
    return `~${formatElapsed(etaMs)}`;
  }
}
