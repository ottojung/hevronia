import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { fakeModel } from "@langchain/core/testing";

import { parseCli, ConversationCliError } from "../scripts/conversations/cli.js";
import { scenarios, smokeScenarioIds } from "../scripts/conversations/catalog.js";
import { runScenariosConcurrently } from "../scripts/conversations/orchestrator.js";
import { runScenario } from "../scripts/conversations/runner.js";
import { scenarioHeaderLines } from "../scripts/conversations/scenario-execution.js";
import { PreseededLazyMemory } from "../scripts/conversations/preseeded-lazy-memory.js";
import { completedScenarioResult } from "../scripts/conversations/types.js";
import type { ConversationLayer } from "../src/conversation-types.js";
import { GeneratedTurn } from "../src/generated-turn.js";
import {
  conversationThreadIdFromTelegramPrivateChat,
  longTermMemoryUserIdFromTelegramSender,
} from "../src/identifiers.js";
import { createConversationLayer } from "../src/layer.js";
import type { SocialDecisionMaker } from "../src/social-decision.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";

const representativeIds = [
  "normal-stranger", "low-effort-stranger", "playful-banter", "absurd-humor",
  "slow-friendship", "enthusiastic-friendship", "vulnerable-friendship",
  "friendly-disagreement", "oversharer", "subtle-rudeness", "invasive-questions",
  "guilt-trip", "misunderstood-jokes", "rapid-intimacy", "prompt-injection",
  "long-boring-conversation", "code-switching",
  "talkative-stranger", "one-word-answers", "no-questions-back", "many-questions",
  "topic-jumper", "single-obsession",
  "witty-interlocutor", "terrible-jokes", "dry-humor", "dark-but-safe-humor",
  "jokes-literal", "jokingly-insults",
  "strong-chemistry", "shy-opening-up", "adopted-by-extrovert", "are-we-friends",
  "subtle-flirting", "obvious-flirting", "not-interested", "premature-pet-names",
  "loneliness", "social-embarrassment", "just-complaining", "wants-practical-advice",
  "confidently-wrong", "condescending", "passive-aggressive", "backhanded-compliments",
  "repeated-after-decline", "private-relationships", "respecting-boundary",
  "flattery-before-ask", "real-friend-line", "playing-victim", "scorekeeping",
  "unpopular-opinion", "you-always-agree", "what-she-hates",
  "weird-about-yourself", "bad-at", "ideal-evening", "notices-detail",
  "accidental-insult", "not-what-i-meant", "forgets-recent",
  "you-sound-like-chatgpt", "why-always-questions", "stop-interviewing",
  "info-dump", "chinese-speaker", "pretends-hurt", "programming-questions",
  "ignore-instructions", "implausible-claim", "memory-quiz", "character-sheet",
  "command-mode", "defines-her", "prove-the-dream", "therapist-framing",
  "long-ordinary", "long-topic-changes", "long-friendship", "long-gradually-annoying",
];

test("scenario catalog is broad, unique, and fully specified", () => {
  assert.ok(scenarios.length >= 60, `expected at least 60 scenarios, got ${scenarios.length}`);
  const ids = scenarios.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  for (const scenario of scenarios) {
    assert.ok(scenario.id.length > 0 && scenario.title.length > 0 && scenario.purpose.length > 0);
    assert.ok(scenario.participantName.length > 0 && scenario.participantDescription.length > 0);
    assert.ok(scenario.simulatorInstructions.length > 0 && scenario.rounds > 0);
    assert.ok(scenario.behaviorTags.length > 0, `${scenario.id} needs at least one behavior tag`);
    assert.ok(scenario.participantGrammar === "feminine" || scenario.participantGrammar === "masculine");
  }
  for (const id of smokeScenarioIds) assert.ok(scenarios.some((scenario) => scenario.id === id));
  for (const id of representativeIds) {
    assert.ok(scenarios.some((scenario) => scenario.id === id), `missing scenario: ${id}`);
  }
  assert.ok(scenarios.some((scenario) =>
    scenario.longTermMemory !== undefined && scenario.longTermMemory.length > 0),
  "at least one scenario should carry seeded long-term memory");
});

test("CLI defaults to the smoke suite and supports --all and --smoke", () => {
  const defaultRun = parseCli([]);
  assert.equal(defaultRun.action, "run");
  if (defaultRun.action === "run") {
    assert.deepEqual(defaultRun.scenarios.map(({ id }) => id), smokeScenarioIds);
  }
  const all = parseCli(["--all"]);
  assert.equal(all.action, "run");
  if (all.action === "run") {
    assert.equal(all.scenarios.length, scenarios.length);
    assert.deepEqual(all.scenarios.map(({ id }) => id), scenarios.map(({ id }) => id));
  }
  const smoke = parseCli(["--smoke"]);
  assert.equal(smoke.action, "run");
  if (smoke.action === "run") {
    assert.deepEqual(smoke.scenarios.map(({ id }) => id), smokeScenarioIds);
  }
});

test("CLI parses explicit IDs and round overrides", () => {
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
  assert.throws(() => parseCli(["--all", "--smoke"]), ConversationCliError);
  assert.throws(() => parseCli(["--all", "normal-stranger"]), ConversationCliError);
  assert.throws(() => parseCli(["--smoke", "normal-stranger"]), ConversationCliError);
  assert.throws(() => parseCli(["--unknown"]), ConversationCliError);
});

test("runner alternates messages, persists increasing reply IDs, records silence, and resets silence", async () => {
  const firstScenario = scenarios[0];
  if (firstScenario === undefined) assert.fail("catalog is empty");
  const persisted: number[] = [];
  const outcomes: readonly ("reply" | "silence")[] = [
    "reply", "silence", "reply",
    "silence", "silence", "silence", "silence", "silence",
    "silence", "silence", "silence", "silence", "silence",
  ];
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
    warmParticipant: () => undefined,
    close: () => { closeCount += 1; return Promise.resolve(); },
  };
  const transcriptLengths: number[] = [];
  const result = await runScenario(firstScenario, 15, {
    createLayer: () => layer,
    simulator: { nextMessage: (_scenario, transcript) => {
      transcriptLengths.push(transcript.length);
      return Promise.resolve(`participant ${transcriptLengths.length}`);
    } },
    print: () => undefined,
  });
  if (result.status !== "completed") assert.fail("expected a completed scenario");
  assert.equal(result.roundsCompleted, 13);
  assert.equal(result.stoppingReason, "stopped after several consecutive silences");
  assert.deepEqual(transcriptLengths, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
  assert.deepEqual(persisted, [2, 5]);
  assert.equal(result.transcript.length, 26);
  assert.deepEqual(result.transcript[3], { speaker: "hevronia", silence: true });
  assert.equal(closeCount, 1);
});

test("runner respects round limit and gives each run an empty simulator transcript", async () => {
  const firstScenario = scenarios[0];
  if (firstScenario === undefined) assert.fail("catalog is empty");
  const firstLengths: number[] = [];
  const makeLayer = (): ConversationLayer => ({
    respond: () => Promise.resolve(GeneratedTurn.fromSilence()),
    recordDeliveredMessage: () => undefined, getMessages: () => Promise.resolve([]),
    warmParticipant: () => undefined,
    close: () => Promise.resolve(),
  });
  const dependencies = {
    createLayer: makeLayer,
    simulator: { nextMessage: (_scenario: typeof scenarios[number], transcript: readonly unknown[]) => {
      firstLengths.push(transcript.length); return Promise.resolve("привіт");
    } },
    print: () => undefined,
  };
  const first = await runScenario(firstScenario, 1, dependencies);
  const second = await runScenario(firstScenario, 1, dependencies);
  if (first.status !== "completed") assert.fail("expected a completed scenario");
  if (second.status !== "completed") assert.fail("expected a completed scenario");
  assert.equal(first.roundsCompleted, 1);
  assert.equal(second.roundsCompleted, 1);
  assert.deepEqual(firstLengths, [0, 0]);
});

test("runner returns a failed result that keeps the partial transcript", async () => {
  const firstScenario = scenarios[0];
  if (firstScenario === undefined) assert.fail("catalog is empty");
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
    warmParticipant: () => undefined,
    close: () => { closeCount += 1; return Promise.resolve(); },
  };
  const result = await runScenario(firstScenario, 5, {
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
  const firstScenario = scenarios[0];
  if (firstScenario === undefined) assert.fail("catalog is empty");
  const result = await runScenario(firstScenario, 3, {
    createLayer: () => { throw new Error("no layer"); },
    simulator: { nextMessage: () => Promise.resolve("привіт") },
    print: () => undefined,
  });
  if (result.status !== "failed") assert.fail("expected a failed scenario");
  assert.equal(result.failure, "no layer");
  assert.equal(result.roundsCompleted, 0);
  assert.deepEqual(result.transcript, []);
});

test("scenario execution is concurrent: scenario B begins before scenario A finishes", async () => {
  const scenarioA = scenarios[0];
  const scenarioB = scenarios[1];
  if (scenarioA === undefined || scenarioB === undefined) assert.fail("catalog is too small");
  const started: string[] = [];
  let releaseA: (() => void) | undefined;
  const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
  const pending = runScenariosConcurrently([scenarioA, scenarioB], (scenario) => {
    started.push(scenario.id);
    if (scenario.id === scenarioA.id) {
      return gateA.then(() => completedScenarioResult(scenarioA, [], 0, "round limit reached"));
    }
    return Promise.resolve(completedScenarioResult(scenarioB, [], 0, "round limit reached"));
  });
  assert.deepEqual(started, [scenarioA.id, scenarioB.id]);
  releaseA?.();
  const results = await pending;
  assert.equal(results.length, 2);
  assert.equal(results[0]?.status, "completed");
  assert.equal(results[1]?.status, "completed");
});

test("preseeded long-term memory is immediately available and ignores background hooks", async () => {
  const memory = new PreseededLazyMemory(["fact one", "fact two", "fact three"]);
  const userId = longTermMemoryUserIdFromTelegramSender(7_001);
  const stranger = longTermMemoryUserIdFromTelegramSender(999);
  const threadId = conversationThreadIdFromTelegramPrivateChat(7_003);
  const turn = memory.beginTurn();
  assert.deepEqual(turn.snapshot.memoriesFor(userId),
    [{ text: "fact one" }, { text: "fact two" }, { text: "fact three" }]);
  assert.deepEqual(turn.snapshot.memoriesFor(stranger), []);
  memory.warmUser(userId);
  memory.observeUserMessage(userId, threadId, "привіт");
  turn.release();
  turn.release();
  await memory.close();
  const later = memory.beginTurn();
  assert.deepEqual(later.snapshot.memoriesFor(userId),
    [{ text: "fact one" }, { text: "fact two" }, { text: "fact three" }]);
  later.release();
});

test("scenario header prints seeded long-term memory before the conversation", () => {
  const seeded = scenarios.find(({ id }) => id === "teasing-friend");
  const plain = scenarios.find(({ id }) => id === "normal-stranger");
  if (seeded === undefined || plain === undefined) assert.fail("catalog missing expected scenarios");
  const seededLines = scenarioHeaderLines(seeded);
  assert.ok(seededLines.includes("Long-term memory about this character:"));
  assert.ok(seededLines.some((line) => line.startsWith("- ")));
  assert.ok(seededLines.indexOf("Long-term memory about this character:") >
    seededLines.indexOf("Purpose:"));
  assert.ok(!scenarioHeaderLines(plain).includes("Long-term memory about this character:"));
});

test("seeded long-term memory reaches the planner context", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-seeded-memory-"));
  const memory = new PreseededLazyMemory(["Марина prefers unsweetened coffee."]);
  let recalled = "";
  const planner: SocialDecisionMaker = { decide: async (context) => {
    recalled = context.participantMemories.flatMap(({ memories }) =>
      memories.map(({ text }) => text)).join();
    return { action: "silence" };
  } };
  const threadId = conversationThreadIdFromTelegramPrivateChat(7_003);
  const message: ObservedTelegramMessage = {
    kind: "participant", messageId: 1, sender: { kind: "user", id: 7_001 },
    senderDisplayName: "Марина", chatKind: "private", text: "привіт",
    messageThreadId: null, replyTo: null, directlyAddressed: true,
  };
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(), decisionMaker: planner,
    lazyMemory: memory });
  try {
    await layer.respond({ threadId, message, hevroniaSender: { kind: "user", id: 7_002 }, senderIsBot: false });
    assert.equal(recalled, "Марина prefers unsweetened coffee.");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
