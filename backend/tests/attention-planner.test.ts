import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
import { applyProposedNames } from "../src/natural-names/apply.js";
import { createNaturalNameStore } from "../src/natural-names/store.js";
import type { TurnContext } from "../src/realizer-response-schema.js";
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

const choice = (handle: string, id: number, username: string | null = null): MissingNaturalNameChoice => ({
  handle,
  sender: { kind: "user", id },
  displayName: "Display",
  username,
});

function plannerWithResponse(content: string) {
  const model = fakeModel();
  model.respond(new AIMessage(content));
  return createAttentionPlanner(model);
}

test("missingNaturalNameChoices derives only unnamed visible users with aligned handles", () => {
  const visible: import("../src/realizer-response-schema.js").VisibleMessage[] = [
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

  assert.equal(parse({ attention: "yes", naturalNames: { P2: "Аня", P4: "Боб" } }).success, true);
  // already-named, channel, stale, and arbitrary handles are impossible
  assert.equal(parse({ attention: "yes", naturalNames: { P1: "Роб", P2: "Аня", P4: "Боб" } }).success, false);
  assert.equal(parse({ attention: "yes", naturalNames: { P3: "Канал", P2: "Аня", P4: "Боб" } }).success, false);
  assert.equal(parse({ attention: "yes", naturalNames: { P999: "Хто", P2: "Аня", P4: "Боб" } }).success, false);
  // both unnamed handles are required
  assert.equal(parse({ attention: "yes", naturalNames: { P2: "Аня" } }).success, false);
  assert.equal(parse({ attention: "yes", naturalNames: { P4: "Боб" } }).success, false);
  assert.equal(parse({ attention: "yes", naturalNames: {} }).success, false);
  assert.equal(parse({ attention: "yes" }).success, false);
  assert.equal(parse({ attention: "no", naturalNames: { P2: "Аня", P4: "Боб" } }).success, true);
  assert.equal(parse({ attention: "maybe", naturalNames: { P2: "Аня", P4: "Боб" } }).success, false);
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

test("the naming value schema allows a Cyrillic alias or null, never a username", () => {
  const schema = buildPlannerResponseSchema([choice("P2", 63, "wt_t1g3y137")]);
  const parse = (name: unknown) => schema.safeParse({
    attention: "yes", naturalNames: { P2: name },
  }).success;
  assert.equal(parse("Боб"), true);
  assert.equal(parse("Супербоб"), true);
  assert.equal(parse("Анна"), true);
  assert.equal(parse(null), true, "the planner may decline an alias");
  assert.equal(parse("@wt_t1g3y137"), false, "the app owns the @username fallback, not the schema");
  assert.equal(parse("wt_t1g3y137"), false, "raw username is rejected");
  assert.equal(parse("@wt_t1g3y138"), false, "modified username is rejected");
  assert.equal(parse("CyberBob"), false, "Latin invented nickname is rejected");
  assert.equal(parse("Аня1"), false, "digit is not a name");
});

test("the naming value schema allows null for a user without a username", () => {
  const schema = buildPlannerResponseSchema([choice("P2", 63, null)]);
  const parse = (name: unknown) => schema.safeParse({
    attention: "yes", naturalNames: { P2: name },
  }).success;
  assert.equal(parse("Олена"), true);
  assert.equal(parse(null), true);
  assert.equal(parse("@wt_t1g3y137"), false);
  assert.equal(parse("Bob"), false);
});

test("the provider value schema encodes the Cyrillic alias or null restriction", () => {
  const serialized = JSON.stringify(buildPlannerJsonSchema([choice("P2", 63, "wt_t1g3y137")]));
  assert.ok(serialized.includes('"pattern":'));
  assert.ok(serialized.includes('"type":"null"'));
  assert.ok(serialized.includes('"anyOf"'));
  assert.ok(serialized.includes("А-Яа-я"));
  assert.doesNotMatch(serialized, /@wt_t1g3y137/);
});

test("the latest visible Telegram metadata wins for a recurring sender", async () => {
  const visible: import("../src/realizer-response-schema.js").VisibleMessage[] = [
    { messageId: 1, sender: { kind: "user", id: 52 }, senderDisplayName: "Bob",
      senderUsername: null, text: "old" },
    { messageId: 2, sender: { kind: "user", id: 52 }, senderDisplayName: "SuperBob3000",
      senderUsername: "super_bob3000", text: "new" },
  ];
  const characters = buildHandleChoices(visible).characters;
  assert.equal(characters.length, 1);
  assert.equal(characters[0]?.character.displayName, "SuperBob3000");
  assert.equal(characters[0]?.character.username, "super_bob3000");
  const choices = missingNaturalNameChoices(characters, new Map());
  assert.equal(choices[0]?.username, "super_bob3000");
  assert.equal(choices[0]?.displayName, "SuperBob3000");
  // the app's null fallback uses the latest username, never the stale one
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-latest-"));
  const store = createNaturalNameStore(path.join(dir, "natural-names.sqlite"));
  try {
    const applied = await applyProposedNames(
      store, choices, { P1: null }, new Map(),
    );
    assert.equal(applied.merged.get(52), "@super_bob3000");
    assert.equal(applied.newNames["P1"], "@super_bob3000");
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an exact planner response returns attention and names", async () => {
  const planner = plannerWithResponse(JSON.stringify({
    attention: "yes", naturalNames: { P2: "Аня" },
  }));
  const decision = await planner.consider(context, [choice("P2", 63)]);
  assert.deepEqual(decision, { attention: true, naturalNames: { P2: "Аня" } });
});

test("a planner response with a null alias round-trips as null", async () => {
  const planner = plannerWithResponse(JSON.stringify({
    attention: "yes", naturalNames: { P2: null },
  }));
  const decision = await planner.consider(context, [choice("P2", 63, "wt_t1g3y137")]);
  assert.deepEqual(decision, { attention: true, naturalNames: { P2: null } });
});

test("the app resolves a null alias to the exact @username when one exists", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-app-fallback-"));
  const store = createNaturalNameStore(path.join(dir, "natural-names.sqlite"));
  try {
    const applied = await applyProposedNames(
      store, [choice("P2", 63, "wt_t1g3y137")], { P2: null }, new Map(),
    );
    assert.equal(applied.merged.get(63), "@wt_t1g3y137");
    assert.deepEqual(applied.newNames, { P2: "@wt_t1g3y137" });
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the app leaves a null-alias person unnamed when there is no username", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-app-none-"));
  const store = createNaturalNameStore(path.join(dir, "natural-names.sqlite"));
  try {
    const applied = await applyProposedNames(
      store, [choice("P2", 63, null)], { P2: null }, new Map(),
    );
    assert.equal(applied.merged.get(63), undefined);
    assert.deepEqual(applied.newNames, {});
    assert.equal(await store.get(63), undefined);
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
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

test("one source of truth: the same choices drive the prompt and the schema", () => {
  const choices = [choice("P2", 63), choice("P4", 94)];
  const rendered = renderPlannerContext(context, choices);
  const schema = buildPlannerResponseSchema(choices);
  assert.ok(rendered.includes("P2 = character 63"));
  assert.ok(rendered.includes("P4 = character 94"));
  assert.ok(rendered.includes("Names to assign:"));
  const parsed = schema.safeParse({ attention: "yes", naturalNames: { P2: "Аня", P4: "Боб" } });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(Object.keys(parsed.data.naturalNames), ["P2", "P4"]);
  }
  for (const handle of ["P1", "P3", "P999"]) {
    assert.ok(!rendered.includes(`Names to assign:\n${handle}`));
    assert.equal(schema.safeParse({
      attention: "yes",
      naturalNames: { P2: "Аня", P4: "Боб", [handle]: "Хто" },
    }).success, false, `${handle} must not be an allowed naming property`);
  }
});
