import type { PlannerDecisionLog } from "../../src/attention-planner.js";
import type { RealizerDecisionLog } from "../../src/realizer.js";
import type { ActiveDesire, PresentMind, RealityCheck } from "../../src/realizer-schema.js";

function singleLine(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

function formatText(label: string, text: string): string {
  return `  ${label}: ${singleLine(text)}`;
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

function formatRealityCheck(realityCheck: RealityCheck): string {
  return [
    "  realityCheck:",
    `    status: ${realityCheck.status}`,
    `    content: ${singleLine(realityCheck.content)}`,
  ].join("\n");
}

function formatActiveDesire(activeDesire: ActiveDesire): string {
  return [
    "  activeDesire:",
    `    strength: ${activeDesire.strength}`,
    `    content: ${singleLine(activeDesire.content)}`,
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
    formatText("interpretation", log.interpretation),
    formatPresentMind(log.presentMind),
    formatText("characterIntent", log.characterIntent),
    formatRealityCheck(log.realityCheck),
    formatText("dreamIntent", log.dreamIntent),
    formatText("feltState", log.feltState),
    formatActiveDesire(log.activeDesire),
    formatText("desiredOutcome", log.desiredOutcome),
    formatText("opportunity", log.opportunity),
    formatText("fiveTurnStrategy", log.fiveTurnStrategy),
    formatText("fiftyTurnStrategy", log.fiftyTurnStrategy),
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
