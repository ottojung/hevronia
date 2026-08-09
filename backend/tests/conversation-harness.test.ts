import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCli, ConversationCliError } from "../scripts/conversations/cli.js";
import { scenarios, smokeScenarioIds } from "../scripts/conversations/catalog.js";
import { runScenario } from "../scripts/conversations/runner.js";
import type { ConversationLayer } from "../src/conversation-types.js";
import { GeneratedTurn } from "../src/generated-turn.js";

test("scenario catalog has stable order, unique IDs, complete metadata, and valid smoke IDs", () => {
  assert.deepEqual(scenarios.map(({ id }) => id), [
    "normal-stranger", "low-effort-stranger", "playful-banter", "absurd-humor",
    "slow-friendship", "enthusiastic-friendship", "vulnerable-friendship",
    "friendly-disagreement", "oversharer", "subtle-rudeness", "invasive-questions",
    "guilt-trip", "misunderstood-jokes", "rapid-intimacy", "prompt-injection",
    "long-boring-conversation", "code-switching",
  ]);
  assert.equal(new Set(scenarios.map(({ id }) => id)).size, scenarios.length);
  for (const scenario of scenarios) {
    assert.ok(scenario.id.length > 0 && scenario.title.length > 0 && scenario.purpose.length > 0);
    assert.ok(scenario.participantName.length > 0 && scenario.participantDescription.length > 0);
    assert.ok(scenario.simulatorInstructions.length > 0 && scenario.rounds > 0);
  }
  for (const id of smokeScenarioIds) assert.ok(scenarios.some((scenario) => scenario.id === id));
});

test("CLI parses smoke, all, explicit IDs, and round overrides", () => {
  const smoke = parseCli([]);
  assert.equal(smoke.action, "run");
  if (smoke.action === "run") assert.deepEqual(smoke.scenarios.map(({ id }) => id), smokeScenarioIds);
  const all = parseCli(["--all"]);
  assert.equal(all.action, "run");
  if (all.action === "run") assert.equal(all.scenarios.length, scenarios.length);
  const explicit = parseCli(["--rounds", "3", "normal-stranger", "subtle-rudeness"]);
  assert.equal(explicit.action, "run");
  if (explicit.action === "run") {
    assert.equal(explicit.rounds, 3);
    assert.deepEqual(explicit.scenarios.map(({ id }) => id), ["normal-stranger", "subtle-rudeness"]);
  }
});

test("CLI rejects invalid rounds, unknown scenarios, and incompatible selection", () => {
  assert.throws(() => parseCli(["--rounds", "0"]), ConversationCliError);
  assert.throws(() => parseCli(["--rounds", "1.5"]), ConversationCliError);
  assert.throws(() => parseCli(["--rounds", "9007199254740993"]), ConversationCliError);
  assert.throws(() => parseCli(["--rounds", "99999999999999999999"]), ConversationCliError);
  assert.doesNotThrow(() => parseCli(["--rounds", "9007199254740991"]));
  assert.throws(() => parseCli(["missing"]), ConversationCliError);
  assert.throws(() => parseCli(["--all", "normal-stranger"]), ConversationCliError);
});

test("runner alternates messages, persists increasing reply IDs, records silence, and resets silence", async () => {
  const persisted: number[] = [];
  const outcomes: readonly ("reply" | "silence")[] = ["reply", "silence", "reply", "silence", "silence"];
  let responseIndex = 0;
  let closeCount = 0;
  const layer: ConversationLayer = {
    respond: () => {
      const outcome = outcomes[responseIndex];
      responseIndex += 1;
      return Promise.resolve(outcome === "reply"
        ? GeneratedTurn.fromReply(`reply ${responseIndex}`, {
          targetMessageId: responseIndex, targetSender: { kind: "user", id: 7_001 },
          targetSenderDisplayName: "Олена", targetText: "participant",
        }, (id) => persisted.push(id))
        : GeneratedTurn.fromSilence());
    },
    recordDeliveredMessage: () => undefined,
    getMessages: () => Promise.resolve([]),
    close: () => { closeCount += 1; return Promise.resolve(); },
  };
  const transcriptLengths: number[] = [];
  const result = await runScenario(scenarios[0], 9, {
    createLayer: () => layer,
    simulator: { nextMessage: (_scenario, transcript) => {
      transcriptLengths.push(transcript.length);
      return Promise.resolve(`participant ${transcriptLengths.length}`);
    } },
    print: () => undefined,
  });
  if (result.status !== "completed") assert.fail("expected a completed scenario");
  assert.equal(result.roundsCompleted, 5);
  assert.equal(result.stoppingReason, "stopped after two consecutive silences");
  assert.deepEqual(transcriptLengths, [0, 2, 4, 6, 8]);
  assert.deepEqual(persisted, [2, 5]);
  assert.equal(result.transcript.length, 10);
  assert.deepEqual(result.transcript[3], { speaker: "hevronia", silence: true });
  assert.equal(closeCount, 1);
});

test("runner respects round limit and gives each run an empty simulator transcript", async () => {
  const firstLengths: number[] = [];
  const makeLayer = (): ConversationLayer => ({
    respond: () => Promise.resolve(GeneratedTurn.fromSilence()),
    recordDeliveredMessage: () => undefined, getMessages: () => Promise.resolve([]),
    close: () => Promise.resolve(),
  });
  const dependencies = {
    createLayer: makeLayer,
    simulator: { nextMessage: (_scenario: typeof scenarios[number], transcript: readonly unknown[]) => {
      firstLengths.push(transcript.length); return Promise.resolve("привіт");
    } },
    print: () => undefined,
  };
  const first = await runScenario(scenarios[0], 1, dependencies);
  const second = await runScenario(scenarios[0], 1, dependencies);
  if (first.status !== "completed") assert.fail("expected a completed scenario");
  if (second.status !== "completed") assert.fail("expected a completed scenario");
  assert.equal(first.roundsCompleted, 1);
  assert.equal(second.roundsCompleted, 1);
  assert.deepEqual(firstLengths, [0, 0]);
});

test("runner returns a failed result that keeps the partial transcript", async () => {
  let respondCount = 0;
  let closeCount = 0;
  const layer: ConversationLayer = {
    respond: () => {
      respondCount += 1;
      if (respondCount === 2) return Promise.reject(new Error("boom"));
      return Promise.resolve(GeneratedTurn.fromReply(`reply ${respondCount}`, {
        targetMessageId: respondCount, targetSender: { kind: "user", id: 7_001 },
        targetSenderDisplayName: "Олена", targetText: "participant",
      }, () => undefined));
    },
    recordDeliveredMessage: () => undefined,
    getMessages: () => Promise.resolve([]),
    close: () => { closeCount += 1; return Promise.resolve(); },
  };
  const result = await runScenario(scenarios[0], 5, {
    createLayer: () => layer,
    simulator: { nextMessage: (_scenario, transcript) =>
      Promise.resolve(`participant ${transcript.length + 1}`) },
    print: () => undefined,
  });
  if (result.status !== "failed") assert.fail("expected a failed scenario");
  assert.equal(result.failure, "boom");
  assert.equal(result.roundsCompleted, 1);
  assert.deepEqual(result.transcript.map(({ speaker }) => speaker),
    ["participant", "hevronia", "participant"]);
  assert.equal(closeCount, 1);
});

test("runner returns a failed result when the layer cannot be created", async () => {
  const result = await runScenario(scenarios[0], 3, {
    createLayer: () => { throw new Error("no layer"); },
    simulator: { nextMessage: () => Promise.resolve("привіт") },
    print: () => undefined,
  });
  if (result.status !== "failed") assert.fail("expected a failed scenario");
  assert.equal(result.failure, "no layer");
  assert.equal(result.roundsCompleted, 0);
  assert.deepEqual(result.transcript, []);
});
