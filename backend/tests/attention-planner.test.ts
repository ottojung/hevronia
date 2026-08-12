import assert from "node:assert/strict";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import {
  buildPlannerJsonSchema,
  buildPlannerResponseSchema,
  createAttentionPlanner,
  missingNaturalNameChoices,
  renderPlannerContext,
  type MissingNaturalNameChoice,
} from "../src/attention-planner.js";
import { buildHandleChoices } from "../src/handles.js";
import type { TurnContext } from "../src/realizer-schema.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";

function message(overrides: Partial<ObservedTelegramMessage> = {}): ObservedTelegramMessage {
  return { kind: "participant", messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", senderUsername: null, chatKind: "group",
    messageThreadId: null, text: "та ні", replyTo: null, directlyAddressed: false, ...overrides };
}

const context: TurnContext = {
  boundedHistory: [],
  currentMessage: message(),
  visibleMessages: [{ messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", senderUsername: null, text: "та ні" }],
  participantMemories: [],
  naturalNames: new Map(),
};

const choice = (handle: string, id: number): MissingNaturalNameChoice => ({
  handle,
  sender: { kind: "user", id },
  displayName: "Display",
  username: null,
});

function plannerWithResponse(content: string) {
  const model = fakeModel();
  model.respond(new AIMessage(content));
  return createAttentionPlanner(model);
}

test("missingNaturalNameChoices derives only unnamed visible users with aligned handles", () => {
  const visible: import("../src/realizer-schema.js").VisibleMessage[] = [
    { messageId: 1, sender: { kind: "user", id: 52 }, senderDisplayName: "SuperBob3000",
      senderUsername: "super_bob3000", text: "a" },
    { messageId: 2, sender: { kind: "user", id: 63 }, senderDisplayName: "137^WT&^t1g3y",
      senderUsername: null, text: "b" },
    { messageId: 3, sender: { kind: "chat", id: -700 }, senderDisplayName: "Канал",
      senderUsername: null, text: "c" },
    { messageId: 4, sender: { kind: "user", id: 81 }, senderDisplayName: "Олена",
      senderUsername: null, text: "d" },
  ];
  const naturalNames = new Map<number, string>([[52, "Боб"], [81, "Олена"]]);
  const characters = buildHandleChoices(visible, naturalNames).characters;
  assert.equal(characters[0]?.handle, "P1");
  assert.equal(characters[1]?.handle, "P2");
  assert.equal(characters[2]?.handle, "P3");
  assert.equal(characters[3]?.handle, "P4");
  const choices = missingNaturalNameChoices(characters, naturalNames);
  assert.deepEqual(choices.map(({ handle, sender }) => ({ handle, id: sender.id })), [
    { handle: "P2", id: 63 },
  ]);
  assert.equal(choices[0]?.displayName, "137^WT&^t1g3y");
});

test("the dynamic planner schema exposes exactly the unnamed handles and nothing else", () => {
  const schema = buildPlannerResponseSchema([choice("P2", 63), choice("P4", 94)]);
  const parse = (payload: unknown) => schema.safeParse(payload);

  assert.equal(parse({ attention: "yes", naturalNames: { P2: "Мес", P4: "Боб" } }).success, true);
  // already-named, channel, stale, and arbitrary handles are impossible
  assert.equal(parse({ attention: "yes", naturalNames: { P1: "Роб", P2: "Мес", P4: "Боб" } }).success, false);
  assert.equal(parse({ attention: "yes", naturalNames: { P3: "Канал", P2: "Мес", P4: "Боб" } }).success, false);
  assert.equal(parse({ attention: "yes", naturalNames: { P999: "Хто", P2: "Мес", P4: "Боб" } }).success, false);
  // both unnamed handles are required
  assert.equal(parse({ attention: "yes", naturalNames: { P2: "Мес" } }).success, false);
  assert.equal(parse({ attention: "yes", naturalNames: { P4: "Боб" } }).success, false);
  assert.equal(parse({ attention: "yes", naturalNames: {} }).success, false);
  assert.equal(parse({ attention: "yes" }).success, false);
  assert.equal(parse({ attention: "no", naturalNames: { P2: "Мес", P4: "Боб" } }).success, true);
  assert.equal(parse({ attention: "maybe", naturalNames: { P2: "Мес", P4: "Боб" } }).success, false);
});

test("the dynamic planner schema is empty and strict when nobody needs a name", () => {
  const schema = buildPlannerResponseSchema([]);
  assert.equal(schema.safeParse({ attention: "no", naturalNames: {} }).success, true);
  assert.equal(schema.safeParse({ attention: "yes", naturalNames: { P1: "Боб" } }).success, false);
  assert.equal(schema.safeParse({ attention: "yes" }).success, false);
});

test("invalid, empty, and overlong natural names fail the dynamic schema", () => {
  const schema = buildPlannerResponseSchema([choice("P2", 63)]);
  assert.equal(schema.safeParse({ attention: "yes", naturalNames: { P2: "" } }).success, false);
  assert.equal(schema.safeParse({ attention: "yes", naturalNames: { P2: "   " } }).success, false);
  assert.equal(schema.safeParse({ attention: "yes", naturalNames: { P2: "x".repeat(41) } }).success, false);
  assert.equal(schema.safeParse({ attention: "yes", naturalNames: { P2: "Боб" } }).success, true);
});

test("the OpenAI and Gemini provider schemas expose exactly the same naming choices", () => {
  const choices = [choice("P2", 63), choice("P4", 94)];
  const openAi = JSON.stringify(buildPlannerJsonSchema(choices));
  const gemini = JSON.stringify(buildPlannerJsonSchema(choices));
  assert.ok(openAi.includes('"P2"'));
  assert.ok(openAi.includes('"P4"'));
  assert.ok(gemini.includes('"P2"'));
  assert.ok(gemini.includes('"P4"'));
  assert.ok(openAi.includes('"required":["P2","P4"]'));
  assert.ok(gemini.includes('"required":["P2","P4"]'));
  assert.ok(gemini.includes('"additionalProperties":false'));
  assert.ok(openAi.includes('"additionalProperties":false'));
  assert.ok(openAi.includes('"enum":["yes","no"]'));
  assert.doesNotMatch(openAi, /"P1"/);
  assert.doesNotMatch(openAi, /"P3"/);
  assert.doesNotMatch(openAi, /"P999"/);
  assert.equal(openAi, gemini);
});

test("an exact planner response returns attention and names", async () => {
  const planner = plannerWithResponse(JSON.stringify({
    attention: "yes", naturalNames: { P2: "Мес" },
  }));
  const decision = await planner.consider(context, [choice("P2", 63)]);
  assert.deepEqual(decision, { attention: true, naturalNames: { P2: "Мес" } });
});

test("a malformed planner response is a planner failure", async () => {
  for (const content of [
    "maybe",
    JSON.stringify({ attention: "yes" }),
    JSON.stringify({ attention: "yes", naturalNames: {} }),
    JSON.stringify({ attention: "yes", naturalNames: { P1: "Боб" } }),
    JSON.stringify({ attention: "yes", naturalNames: { P2: "" } }),
  ]) {
    const planner = plannerWithResponse(content);
    await assert.rejects(() => planner.consider(context, [choice("P2", 63)]));
  }
});

test("a model error from the planner is a planner failure", async () => {
  const model = fakeModel().alwaysThrow(new Error("planner offline"));
  await assert.rejects(
    () => createAttentionPlanner(model).consider(context, [choice("P2", 63)]),
    /planner offline/,
  );
});

test("private or directly addressed events with no naming work skip the model", async () => {
  const privateChat = { ...context, currentMessage: message({ chatKind: "private" }) };
  const direct = { ...context, currentMessage: message({ directlyAddressed: true }) };
  const model = fakeModel().alwaysThrow(new Error("must not be called"));
  const planner = createAttentionPlanner(model);
  assert.deepEqual(await planner.consider(privateChat, []), { attention: true, naturalNames: {} });
  assert.deepEqual(await planner.consider(direct, []), { attention: true, naturalNames: {} });
});

test("private events with unnamed people still invoke the planner for naming", async () => {
  const privateChat = { ...context, currentMessage: message({ chatKind: "private" }) };
  const planner = plannerWithResponse(JSON.stringify({
    attention: "no", naturalNames: { P1: "Боб" },
  }));
  const decision = await planner.consider(privateChat, [choice("P1", 63)]);
  assert.equal(decision.attention, false);
  assert.deepEqual(decision.naturalNames, { P1: "Боб" });
});

test("the planner context lists the exact names-to-assign handles", () => {
  const rendered = renderPlannerContext(context, [choice("P2", 63)]);
  assert.ok(rendered.includes("Names to assign:"));
  assert.ok(rendered.includes("P2 = character 63"));
  assert.ok(rendered.includes("“Display”"));
});
