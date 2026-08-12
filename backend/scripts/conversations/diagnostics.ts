import type { PlannerDecisionLog } from "../../src/attention-planner.js";
import type { RealizerDecisionLog } from "../../src/realizer.js";
import type { SubjectiveJudgment } from "../../src/realizer-schema.js";

function singleLine(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

function formatJudgment(label: string, judgment: SubjectiveJudgment): string {
  return [
    `  ${label}:`,
    `    leading: ${singleLine(judgment.leading)}`,
    `    alternative: ${singleLine(judgment.alternative)}`,
    `    whyRejected: ${singleLine(judgment.whyRejected)}`,
  ].join("\n");
}

export function formatPlannerLog(log: PlannerDecisionLog): string {
  if (log.outcome === "pass") {
    return "Планер: yes → передано реалізатору";
  }
  if (log.outcome === "filter") {
    return "Планер: no → повідомлення відфільтровано";
  }
  return `Планер: [error → передано реалізатору] ${singleLine(log.errorDetail)}`;
}

function formatJudgments(log: Extract<RealizerDecisionLog, { action: "silence" | "speak" }>): string {
  return [
    formatJudgment("interpretation", log.interpretation),
    formatJudgment("intent", log.intent),
    formatJudgment("feltState", log.feltState),
    formatJudgment("activeDesire", log.activeDesire),
    formatJudgment("desiredOutcome", log.desiredOutcome),
    formatJudgment("opportunity", log.opportunity),
    formatJudgment("pursuit", log.pursuit),
  ].join("\n");
}

export function formatRealizerLog(log: RealizerDecisionLog): string {
  if (log.action === "failure") {
    return `Реалізатор: [error] ${singleLine(log.errorDetail)}`;
  }
  const judgments = formatJudgments(log);
  if (log.action === "silence") {
    return ["Реалізатор: [silence]", judgments].join("\n");
  }
  const address = log.addressLabel ?? "(нікому)";
  const replyTo = log.replyToLabel ?? "none";
  return [
    `Реалізатор: speak → ${address}`,
    `  replyTo: ${replyTo}`,
    judgments,
  ].join("\n");
}
