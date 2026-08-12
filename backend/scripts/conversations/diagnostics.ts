import type { PlannerDecisionLog } from "../../src/attention-planner.js";
import type { RealizerDecisionLog } from "../../src/realizer.js";

function singleLine(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
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

export function formatRealizerLog(log: RealizerDecisionLog): string {
  if (log.action === "failure") {
    return `Реалізатор: [error] ${singleLine(log.errorDetail)}`;
  }
  const fields = [
    `  interpretation: ${log.interpretation}`,
    `  intent: ${log.intent}`,
    `  feltState: ${log.feltState}`,
    `  activeDesire: ${log.activeDesire}`,
    `  desiredOutcome: ${log.desiredOutcome}`,
    `  opportunity: ${log.opportunity}`,
    `  pursuit: ${log.pursuit}`,
  ];
  if (log.action === "silence") {
    return ["Реалізатор: [silence]", ...fields].join("\n");
  }
  const address = log.addressLabel ?? "(нікому)";
  const replyTo = log.replyToLabel ?? "none";
  return [
    `Реалізатор: speak → ${address}`,
    `  replyTo: ${replyTo}`,
    ...fields,
  ].join("\n");
}
