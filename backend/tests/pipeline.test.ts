import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { ChatOpenAI } from "@langchain/openai";

import type { PlannerDecisionLog } from "../src/attention-planner.js";
import { conversationThreadIdFromTelegramPrivateChat } from "../src/identifiers.js";
import {
  cheapModelFromEnv,
  createChatModel,
  isGeminiChatModel,
  smartModelFromEnv,
} from "../src/model.js";
import { SYSTEM_PROMPT } from "../src/personality.js";
import { createRealizer } from "../src/realizer.js";
import type { RealizerDecisionLog } from "../src/realizer.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";
import { formatPlannerLog, formatRealizerLog } from "../scripts/conversations/diagnostics.js";
import {
  filteringPlanner,
  passingPlanner,
  realizerSilence,
  realizerSpeak,
  stubRealizer,
  stubPlanner,
  testLayer,
} from "./memory-fixtures.js";

const threadId = conversationThreadIdFromTelegramPrivateChat(66);

function message(id = 1, text = "привіт"): ObservedTelegramMessage {
  return { kind: "participant", messageId: id, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", chatKind: "group", messageThreadId: null, text, replyTo: null,
    directlyAddressed: false };
}

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "hevronia-pipeline-"));
}

test("a planner failure fails open to the smart realizer", async () => {
  const dir = tempDir();
  const logs: PlannerDecisionLog[] = [];
  const layer = testLayer(path.join(dir, "db.sqlite"), {
    planner: { consider: async () => { throw new Error("planner boom"); } },
    realizer: stubRealizer(realizerSpeak({ message: "ага" })),
    onPlannerDecision: (log) => logs.push(log),
  });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "speak");
    if (turn.outcome.action === "speak") assert.equal(turn.outcome.replyText, "ага");
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.outcome, "failure");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planner no prevents the smart realizer from being invoked", async () => {
  const dir = tempDir();
  let realized = false;
  const layer = testLayer(path.join(dir, "db.sqlite"), {
    planner: filteringPlanner(),
    realizer: { realize: async () => { realized = true; return realizerSilence(); } },
  });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "silence");
    assert.equal(realized, false);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planner yes invokes the smart realizer", async () => {
  const dir = tempDir();
  let realized = false;
  const layer = testLayer(path.join(dir, "db.sqlite"), {
    planner: passingPlanner(),
    realizer: { realize: async () => { realized = true; return realizerSilence(); } },
  });
  try {
    await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(realized, true);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planner yes + realizer silence produces silence", async () => {
  const dir = tempDir();
  const layer = testLayer(path.join(dir, "db.sqlite"), {
    planner: passingPlanner(),
    realizer: stubRealizer(realizerSilence()),
  });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "silence");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planner yes + realizer speak produces a delivered message", async () => {
  const dir = tempDir();
  const layer = testLayer(path.join(dir, "db.sqlite"), {
    planner: passingPlanner(),
    realizer: stubRealizer(realizerSpeak({ message: "я тут" })),
  });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "speak");
    if (turn.outcome.action === "speak") assert.equal(turn.outcome.replyText, "я тут");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the realizer independently selects the addressee", async () => {
  const dir = tempDir();
  const logs: RealizerDecisionLog[] = [];
  const layer = testLayer(path.join(dir, "db.sqlite"), {
    planner: passingPlanner(),
    realizer: stubRealizer(realizerSpeak({ addressCharacter: "P1", message: "тобі кажу" })),
    onRealizerDecision: (log) => logs.push(log),
  });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "speak");
    const log = logs[0];
    assert.equal(log?.action, "speak");
    if (log?.action === "speak") assert.equal(log.addressLabel, "character 88");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the realizer independently selects a reply attachment", async () => {
  const dir = tempDir();
  const layer = testLayer(path.join(dir, "db.sqlite"), {
    planner: passingPlanner(),
    realizer: stubRealizer(realizerSpeak({ addressCharacter: "P1", replyToMessage: "M1" })),
  });
  try {
    const turn = await layer.respond({ threadId, message: message(10, "питання"),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "speak");
    if (turn.outcome.action === "speak") assert.equal(turn.outcome.replyTo?.targetMessageId, 10);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the realizer can address somebody without a reply attachment", async () => {
  const dir = tempDir();
  const logs: RealizerDecisionLog[] = [];
  const layer = testLayer(path.join(dir, "db.sqlite"), {
    planner: passingPlanner(),
    realizer: stubRealizer(realizerSpeak({ addressCharacter: "P1", replyToMessage: null })),
    onRealizerDecision: (log) => logs.push(log),
  });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "speak");
    if (turn.outcome.action === "speak") assert.equal(turn.outcome.replyTo, null);
    const log = logs[0];
    if (log?.action === "speak") {
      assert.equal(log.addressLabel, "character 88");
      assert.equal(log.replyToLabel, null);
    }
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid realizer handles cannot cause misdelivery", async () => {
  const dir = tempDir();
  const logs: RealizerDecisionLog[] = [];
  const layer = testLayer(path.join(dir, "db.sqlite"), {
    planner: passingPlanner(),
    realizer: stubRealizer(realizerSpeak({ addressCharacter: "P9", message: "не туди" })),
    onRealizerDecision: (log) => logs.push(log),
  });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "silence");
    assert.equal(logs[0]?.action, "failure");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the planner model is cheap with low thinking; the realizer is smart without it", () => {
  process.env["MY_GEMINI_API_KEY"] = "gem-key";
  process.env["MY_OPENAI_API_KEY"] = "sk-key";
  try {
    const plannerModel = createChatModel(cheapModelFromEnv(), { lowThinking: true, temperature: 0 });
    assert.ok(isGeminiChatModel(plannerModel));
    if (isGeminiChatModel(plannerModel)) {
      assert.equal(plannerModel.thinkingConfig?.thinkingLevel, "LOW");
    }
    const realizerModel = createChatModel(smartModelFromEnv());
    assert.ok(isGeminiChatModel(realizerModel));
    if (isGeminiChatModel(realizerModel)) {
      assert.equal(realizerModel.thinkingConfig, undefined);
    }
    const cheapOpenAi = createChatModel("gpt-5.6-luna", { lowThinking: true });
    assert.ok(cheapOpenAi instanceof ChatOpenAI);
    assert.equal(cheapOpenAi.reasoning?.effort, "low");
    const smartOpenAi = createChatModel("gpt-5.6-luna");
    assert.ok(smartOpenAi instanceof ChatOpenAI);
    assert.equal(smartOpenAi.reasoning?.effort, undefined);
    const deterministicOpenAi = createChatModel("gpt-5.6-luna", { temperature: 0 });
    assert.ok(deterministicOpenAi instanceof ChatOpenAI);
    assert.equal(deterministicOpenAi.temperature, undefined);
    const tunedOpenAi = createChatModel("gpt-5.6-luna", { temperature: 0.5 });
    assert.ok(tunedOpenAi instanceof ChatOpenAI);
    assert.equal(tunedOpenAi.temperature, 0.5);
  } finally {
    delete process.env["MY_GEMINI_API_KEY"];
    delete process.env["MY_OPENAI_API_KEY"];
  }
});

test("the realizer receives the full personality, history, and memories, not planner psychology", async () => {
  const dir = tempDir();
  const captured: string[] = [];
  const model = fakeModel();
  model.respond((messages) => {
    captured.push(messages.map((item) => typeof item.content === "string" ? item.content : JSON.stringify(item.content)).join("\n"));
    return new AIMessage(JSON.stringify({ decision: realizerSpeak({ message: "ага" }) }));
  });
  const planner = stubPlanner((context) => context.participantMemories.length === 0);
  const layer = testLayer(path.join(dir, "db.sqlite"), {
    planner,
    realizer: createRealizer(model, SYSTEM_PROMPT),
  });
  try {
    await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    const input = captured.join("\n");
    assert.match(input, /You are Хевронія/);
    assert.match(input, /Character 88, currently displayed by Telegram as “Іра”/);
    assert.match(input, /Your sleeping mind made character 88 say:/);
    assert.match(input, /Character handles \(addressCharacter must be one of these\)/);
    assert.doesNotMatch(input, /Planner character handles/);
    assert.doesNotMatch(input, /telegram-user:/);
    assert.doesNotMatch(input, /spreadsheet/);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("conversation diagnostics distinguish filtered, realizer-silence, and realizer-speak", () => {
  assert.ok(formatPlannerLog({ outcome: "pass" }).includes("yes"));
  assert.ok(formatPlannerLog({ outcome: "filter" }).includes("відфільтровано"));
  const failure = formatPlannerLog({ outcome: "failure", errorDetail: "boom" });
  assert.ok(failure.includes("передано реалізатору"));
  assert.ok(failure.includes("boom"));

  const judgment = (leading: string) => ({ leading, alternative: "alt", whyRejected: "why" });
  const silenceLog: RealizerDecisionLog = {
    action: "silence",
    interpretation: judgment("i"), intent: judgment("t"), feltState: judgment("f"),
    activeDesire: judgment("a"), desiredOutcome: judgment("o"), opportunity: judgment("o"),
    pursuit: judgment("p"),
  };
  const silence = formatRealizerLog(silenceLog);
  assert.ok(silence.startsWith("Реалізатор: [silence]"));
  assert.ok(silence.includes("  interpretation:"));
  assert.ok(silence.includes("    leading: i"));
  assert.ok(silence.includes("    alternative: alt"));
  assert.ok(silence.includes("    whyRejected: why"));

  const speakLog: RealizerDecisionLog = {
    action: "speak", addressLabel: "character 42", replyToLabel: "M1 → Іра",
    interpretation: judgment("i"), intent: judgment("t"), feltState: judgment("f"),
    activeDesire: judgment("a"), desiredOutcome: judgment("o"), opportunity: judgment("o"),
    pursuit: judgment("p"),
  };
  const speak = formatRealizerLog(speakLog);
  assert.ok(speak.startsWith("Реалізатор: speak → character 42"));
  assert.ok(speak.includes("  replyTo: M1 → Іра"));
  assert.ok(speak.includes("    leading: i"));
  assert.ok(speak.includes("    alternative: alt"));
  assert.ok(speak.includes("    whyRejected: why"));
});
