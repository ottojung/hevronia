import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { scenarios } from "../scripts/conversations/catalog.js";
import { formatGitRevision } from "../scripts/conversations/git.js";
import { createRunId, saveRun } from "../scripts/conversations/transcript.js";
import { completedScenarioResult } from "../scripts/conversations/types.js";

test("createRunId keeps the date stamp and appends the revision when provided", () => {
  const date = new Date("2026-08-10T23:43:33.250Z");
  assert.equal(createRunId(date), "2026-08-10T23-43-33-250Z");
  assert.equal(createRunId(date, "abc1234"), "2026-08-10T23-43-33-250Z-abc1234");
});

test("formatGitRevision renders the hash with a dirty marker", () => {
  assert.equal(formatGitRevision({ hash: "abc1234", dirty: false }), "abc1234");
  assert.equal(formatGitRevision({ hash: "abc1234", dirty: true }), "abc1234-dirty");
  assert.equal(formatGitRevision(undefined), "unknown");
});

test("saveRun embeds the commit and the ended transcript marker in markdown", async () => {
  const firstScenario = scenarios[0];
  if (firstScenario === undefined) assert.fail("catalog is empty");
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-transcript-"));
  const result = completedScenarioResult(firstScenario,
    [
      { speaker: "participant", text: "привіт" },
      { speaker: "hevronia", ended: true },
    ],
    1, "generator produced no message");
  try {
    await saveRun(dir, [{ scenario: firstScenario, result }], "gpt-5.6-luna", "abc1234-dirty");
    const scenarioMarkdown = readFileSync(path.join(dir, `${firstScenario.id}.md`), "utf8");
    assert.ok(scenarioMarkdown.includes("- **Commit:** abc1234-dirty"));
    assert.ok(scenarioMarkdown.includes("- **Simulator model:** gpt-5.6-luna"));
    assert.ok(scenarioMarkdown.includes("**Хевронія:** [conversation ended]"));
    const indexMarkdown = readFileSync(path.join(dir, "index.md"), "utf8");
    assert.ok(indexMarkdown.includes("- **Commit:** abc1234-dirty"));
    assert.ok(indexMarkdown.includes("- **Simulator model:** gpt-5.6-luna"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
