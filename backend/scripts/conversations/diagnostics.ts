import type { PlannerDecisionLog } from "../../src/attention-planner.js";
import type { RealizerDecisionLog } from "../../src/realizer.js";
import type { PresentMind, RealityCheckJudgment, SubjectiveJudgment } from "../../src/realizer-schema.js";

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

function formatRealityCheck(judgment: RealityCheckJudgment): string {
  const parts = [`  realityCheck:`, `    leading: ${singleLine(judgment.leading)}`];
  if (judgment.alternative !== undefined) {
    parts.push(`    alternative: ${singleLine(judgment.alternative)}`);
  }
  if (judgment.whyRejected !== undefined) {
    parts.push(`    whyRejected: ${singleLine(judgment.whyRejected)}`);
  }
  return parts.join("\n");
}

function formatPresentMind(presentMind: PresentMind): string {
  const secondary = presentMind.secondary.length === 0
    ? "—"
    : presentMind.secondary.map(singleLine).join(" | ");
  return [
    "  presentMind:",
    `    primary: ${singleLine(presentMind.primary)}`,
    `    secondary: ${secondary}`,
  ].join("\n");
}

export function formatPlannerLog(log: PlannerDecisionLog): string {
  if (log.outcome === "failure") {
    return `Планер: [error → передано реалізатору] ${singleLine(log.errorDetail)}`;
  }
  let head: string;
  if (log.outcome === "filter") {
    head = "Планер: no → повідомлення відфільтровано";
  } else if (log.attention) {
    head = "Планер: yes → передано реалізатору";
  } else {
    head = "Планер: no → direct/private, тому передано реалізатору";
  }
  const names = Object.entries(log.naturalNames);
  if (names.length === 0) return head;
  return [
    head,
    "  нові природні імена:",
    ...names.map(([handle, name]) => `    ${handle}: ${name}`),
  ].join("\n");
}

function formatJudgments(log: Extract<RealizerDecisionLog, { action: "silence" | "speak" }>): string {
  return [
    formatJudgment("interpretation", log.interpretation),
    formatPresentMind(log.presentMind),
    formatJudgment("characterIntent", log.characterIntent),
    formatRealityCheck(log.realityCheck),
    formatJudgment("dreamIntent", log.dreamIntent),
    formatJudgment("feltState", log.feltState),
    formatJudgment("activeDesire", log.activeDesire),
    formatJudgment("desiredOutcome", log.desiredOutcome),
    formatJudgment("opportunity", log.opportunity),
    formatJudgment("fiveTurnStrategy", log.fiveTurnStrategy),
    formatJudgment("fiftyTurnStrategy", log.fiftyTurnStrategy),
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
