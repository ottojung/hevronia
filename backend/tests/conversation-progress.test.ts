import assert from "node:assert/strict";
import { test } from "node:test";

import { scenarios } from "../scripts/conversations/catalog.js";
import {
  ConversationProgress,
  formatElapsed,
  formatElapsedSigned,
  totalExpectedRounds,
} from "../scripts/conversations/progress.js";
import { completedScenarioResult, failedScenarioResult } from "../scripts/conversations/types.js";

function etaInSeconds(line: string): number {
  const minute = line.match(/ETA ~(-?\d+)m (\d+)s/);
  if (minute !== null) {
    const minutes = Number(minute[1]);
    const seconds = Number(minute[2]);
    return minutes < 0 ? minutes * 60 - seconds : minutes * 60 + seconds;
  }
  const secondsOnly = line.match(/ETA ~(-?\d+)s/);
  if (secondsOnly !== null) return Number(secondsOnly[1]);
  return Number.NaN;
}

test("totalExpectedRounds sums the expected rounds of every scenario", () => {
  const first = scenarios[0];
  const second = scenarios[1];
  if (first === undefined || second === undefined) assert.fail("catalog is too small");
  assert.equal(totalExpectedRounds([first, second]), first.rounds + second.rounds);
});

test("formatElapsed renders seconds and minute-second durations", () => {
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(45_000), "45s");
  assert.equal(formatElapsed(70_000), "1m 10s");
  assert.equal(formatElapsed(125_000), "2m 5s");
});

test("formatElapsedSigned allows negative durations for a falling ETA", () => {
  assert.equal(formatElapsedSigned(0), "0s");
  assert.equal(formatElapsedSigned(45_000), "45s");
  assert.equal(formatElapsedSigned(-3_000), "-3s");
  assert.equal(formatElapsedSigned(-100_000), "-1m 40s");
  assert.equal(formatElapsedSigned(-125_000), "-2m 5s");
});

test("the live ETA extrapolates the single observation and decreases as time passes", () => {
  const first = scenarios[0];
  if (first === undefined) assert.fail("catalog is too small");
  let now = 0;
  const progress = new ConversationProgress([first], 0, () => now);
  progress.begin(first);
  assert.ok(progress.line().includes(`[0/1] 0/${first.rounds} rounds`), progress.line());
  now = 10_000;
  progress.advance(first.id, 1);
  const line1 = progress.line();
  assert.ok(line1.includes(`[0/1] 1/${first.rounds} rounds`), line1);
  assert.ok(line1.includes("elapsed 10s"), line1);
  assert.ok(line1.includes(`ETA ~${formatElapsedSigned(first.rounds * 10_000 - 10_000)}`), line1);
  now = 20_000;
  const line2 = progress.line();
  assert.ok(line2.includes(`ETA ~${formatElapsedSigned(first.rounds * 10_000 - 20_000)}`), line2);
  assert.ok(etaInSeconds(line2) < etaInSeconds(line1), "ETA must decrease between recomputes");
});

test("the ETA is a least-squares linear regression over the observed points", () => {
  const first = scenarios[0];
  if (first === undefined) assert.fail("catalog is too small");
  let now = 0;
  const progress = new ConversationProgress([first], 0, () => now);
  progress.begin(first);
  now = 10_000;
  progress.advance(first.id, 1);
  now = 40_000;
  progress.advance(first.id, 2);
  // OLS over (10000,1),(40000,2): slope 1/30000 rounds/ms, intercept 2/3.
  const finishTime = (first.rounds - 2 / 3) * 30_000;
  assert.ok(progress.line().includes(
    `ETA ~${formatElapsedSigned(finishTime - 40_000)}`,
  ), progress.line());
});

test("the ETA can fall below zero when the run is slower than the fit predicted", () => {
  const first = scenarios[0];
  if (first === undefined) assert.fail("catalog is too small");
  let now = 0;
  const progress = new ConversationProgress([first], 0, () => now);
  progress.begin(first);
  now = 10_000;
  progress.advance(first.id, 1);
  now = 20_000;
  progress.advance(first.id, 2);
  // OLS over (10000,1),(20000,2): slope 1/10000, intercept 0.
  now = 400_000;
  assert.ok(progress.line().includes(
    `ETA ~${formatElapsedSigned(first.rounds * 10_000 - 400_000)}`,
  ), progress.line());
  assert.ok(etaInSeconds(progress.line()) < 0, "a slow run yields a negative ETA");
});

test("recomputing the coefficients can raise the ETA when the model slows down", () => {
  const first = scenarios[0];
  if (first === undefined) assert.fail("catalog is too small");
  let now = 0;
  const progress = new ConversationProgress([first], 0, () => now);
  progress.begin(first);
  now = 10_000;
  progress.advance(first.id, 1);
  const before = etaInSeconds(progress.line());
  now = 200_000;
  progress.advance(first.id, 2);
  const after = etaInSeconds(progress.line());
  assert.ok(after > before,
    `recomputing coefficients may raise the ETA (before=${before}s, after=${after}s)`);
});

test("finish reports finished over total and resets the live state", () => {
  const first = scenarios[0];
  const second = scenarios[1];
  if (first === undefined || second === undefined) assert.fail("catalog is too small");
  let now = 0;
  const progress = new ConversationProgress([first, second], 0, () => now);
  progress.begin(first);
  now = 40_000;
  progress.advance(first.id, 2);
  const firstLine = progress.finish(first,
    completedScenarioResult(first, [], first.rounds, "round limit reached"));
  assert.ok(
    firstLine.startsWith(`[1/2] ${first.id} done (${first.rounds}/${first.rounds} rounds)`),
    firstLine,
  );
  progress.begin(second);
  assert.ok(progress.line().includes(`[1/2] ${first.rounds}/${first.rounds + second.rounds} rounds`),
    progress.line());
  now = 80_000;
  progress.advance(second.id, second.rounds);
  const secondLine = progress.finish(second,
    completedScenarioResult(second, [], second.rounds, "round limit reached"));
  assert.ok(secondLine.startsWith(`[2/2] ${second.id} done`), secondLine);
  assert.ok(secondLine.includes("ETA ~0s"), secondLine);
});

test("finish reports a failed scenario with its reason", () => {
  const first = scenarios[0];
  if (first === undefined) assert.fail("catalog is too small");
  const progress = new ConversationProgress([first], 0, () => 0);
  progress.begin(first);
  const line = progress.finish(first, failedScenarioResult(first, [], 4, "boom"));
  assert.ok(line.startsWith(`[1/1] ${first.id} failed (4/${first.rounds} rounds) — boom`), line);
  assert.ok(line.includes("ETA ~0s"), line);
});
