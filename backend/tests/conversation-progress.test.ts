import assert from "node:assert/strict";
import { test } from "node:test";

import { scenarios } from "../scripts/conversations/catalog.js";
import { ConversationProgress, formatElapsed, totalExpectedRounds } from "../scripts/conversations/progress.js";
import { completedScenarioResult, failedScenarioResult } from "../scripts/conversations/types.js";

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

test("progress reports finished over total with a linear ETA", () => {
  const first = scenarios[0];
  const second = scenarios[1];
  if (first === undefined || second === undefined) assert.fail("catalog is too small");
  let now = 0;
  const progress = new ConversationProgress([first, second], 0, () => now);
  now = first.rounds * 10_000;
  const firstLine = progress.finish(first,
    completedScenarioResult(first, [], first.rounds, "round limit reached"));
  assert.ok(
    firstLine.startsWith(`[1/2] ${first.id} done (${first.rounds}/${first.rounds} rounds)`),
    firstLine,
  );
  const expectedEta = formatElapsed(second.rounds * 10_000);
  assert.ok(firstLine.includes(`ETA ~${expectedEta}`), firstLine);
  const secondLine = progress.finish(second,
    completedScenarioResult(second, [], second.rounds, "round limit reached"));
  assert.ok(secondLine.startsWith(`[2/2] ${second.id} done`), secondLine);
  assert.ok(secondLine.includes("ETA ~0s"), secondLine);
});

test("progress reports a failed scenario with its reason", () => {
  const first = scenarios[0];
  if (first === undefined) assert.fail("catalog is too small");
  const progress = new ConversationProgress([first], 0, () => 0);
  const line = progress.finish(first, failedScenarioResult(first, [], 4, "boom"));
  assert.ok(line.startsWith(`[1/1] ${first.id} failed (4/${first.rounds} rounds) — boom`), line);
});
