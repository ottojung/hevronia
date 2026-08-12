import type { ConversationScenario, ScenarioResult } from "./types.js";
import { fitProgressRegression, type RegressionFit } from "./regression.js";

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
 * Like `formatElapsed` but allows negative values, used for an ETA that may
 * fall below zero when the run is slower than the fitted rate predicted.
 */
export function formatElapsedSigned(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const totalSeconds = Math.round(Math.abs(ms) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${sign}${seconds}s`;
  return `${sign}${minutes}m ${seconds}s`;
}

/**
 * Cumulative progress for a conversation run: finished scenarios over the
 * total, completed rounds over the total expected rounds, and an ETA from a
 * least-squares linear regression of completed rounds against elapsed time.
 * The coefficients are recomputed every time a model response completes a
 * round (`advance`) or a scenario finishes (`finish`); between recomputes the
 * projected finish time is fixed, so the ETA decreases as time passes and only
 * moves up when the coefficients are refreshed. An ETA below zero simply means
 * the run is slower than the fitted rate predicted. Scenarios run
 * concurrently, so the live line reports only overall progress and never
 * pretends to show a single running scenario.
 */
export class ConversationProgress {
  private readonly totalScenarios: number;
  private readonly totalRounds: number;
  private finished = 0;
  private completedRounds = 0;
  private readonly activeRounds = new Map<string, number>();
  private readonly points: Array<{ elapsed: number; rounds: number }> = [];
  private fit: RegressionFit | undefined;

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
    this.recordPoint();
  }

  line(): string {
    const completedRounds = this.completedRounds + this.totalActiveRounds();
    return `[${this.finished}/${this.totalScenarios}] ${completedRounds}/${this.totalRounds} rounds — elapsed ${this.elapsed()} — ETA ${this.eta(this.finished, completedRounds)}`;
  }

  finish(scenario: ConversationScenario, result: ScenarioResult): string {
    this.activeRounds.delete(scenario.id);
    this.finished += 1;
    this.completedRounds += result.roundsCompleted;
    this.recordPoint();
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

  private recordPoint(): void {
    const elapsed = Math.max(this.now() - this.startedAt, 0);
    const rounds = this.completedRounds + this.totalActiveRounds();
    this.points.push({ elapsed, rounds });
    this.fit = fitProgressRegression(this.points, this.totalRounds);
  }

  private eta(finished: number, completedRounds: number): string {
    if (finished >= this.totalScenarios) return "~0s";
    if (this.totalRounds - completedRounds <= 0) return "~0s";
    if (this.fit === undefined) return "~?";
    const elapsed = Math.max(this.now() - this.startedAt, 0);
    return `~${formatElapsedSigned(this.fit.finishTime - elapsed)}`;
  }
}
