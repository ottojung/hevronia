import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeModel } from "@langchain/core/testing";

import { SYSTEM_PROMPT } from "../src/personality.js";
import { createRealizer } from "../src/realizer.js";
import { RealizerStructuredOutputError } from "../src/realizer-call.js";
import {
  buildRealizerResponseSchema,
} from "../src/realizer-response-schema.js";
import type { TurnContext } from "../src/realizer-response-schema.js";
import {
  activeDesireSchema,
  presentMindSchema,
  realityCheckSchema,
  realizerDecisionObjectSchema,
  realizerDecisionSchema,
} from "../src/realizer-schema.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";
import {
  SequencedStructuredChatModel,
  realizerSilence,
  realizerSpeak,
} from "./memory-fixtures.js";

function message(overrides: Partial<ObservedTelegramMessage> = {}): ObservedTelegramMessage {
  return { kind: "participant", messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", senderUsername: null, chatKind: "group", messageThreadId: null,
    text: "та ні", replyTo: null, directlyAddressed: false, ...overrides };
}

const context: TurnContext = {
  boundedHistory: [],
  currentMessage: message(),
  visibleMessages: [{ messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", senderUsername: null, text: "та ні" }],
  participantMemories: [],
  naturalNames: new Map(),
};

function realizerWithStructuredResponse(value: Record<string, unknown>) {
  const model = fakeModel();
  model.structuredResponse(value);
  return createRealizer(model, SYSTEM_PROMPT);
}

function realizerWithSequencedResponses(values: unknown[]) {
  return createRealizer(new SequencedStructuredChatModel(values), SYSTEM_PROMPT);
}

test("realizer uses the direct structured-output path and never an agent", async () => {
  const silence = realizerSilence();
  const realizer = realizerWithStructuredResponse(silence);
  assert.deepEqual(await realizer.realize(context), silence);
});

test("realizer returns a valid speak decision with message and handles", async () => {
  const decision = realizerSpeak({ message: "стій, я зараз" });
  const realizer = realizerWithStructuredResponse(decision);
  assert.deepEqual(await realizer.realize(context), decision);
});

test("the dynamic schema restricts addressCharacter and replyToMessage to visible handles", () => {
  const schema = buildRealizerResponseSchema(context.visibleMessages);
  const speak = realizerSpeak({ addressCharacter: "P1", replyToMessage: "M1" });
  assert.equal(schema.safeParse(speak).success, true);
  for (const bad of ["7001", "Юхим", "character 7001", "P9", "M9", "я не братимусь розбирати це"]) {
    assert.equal(schema.safeParse({ ...speak, addressCharacter: bad }).success,
      false, `addressCharacter=${bad}`);
    assert.equal(schema.safeParse({ ...speak, replyToMessage: bad }).success,
      false, `replyToMessage=${bad}`);
  }
});

test("every decision field is required; there are no optional fields", () => {
  const shape = realizerDecisionObjectSchema.shape;
  const topLevelKeys = [
    "interpretation", "presentMind", "characterIntent", "realityCheck", "dreamIntent",
    "feltState", "activeDesire", "desiredOutcome", "opportunity", "fiveTurnStrategy",
    "fiftyTurnStrategy", "action", "message", "addressCharacter", "replyToMessage",
  ];
  assert.deepEqual(Object.keys(shape).sort(), [...topLevelKeys].sort());

  // A decision missing any single top-level field must fail, proving every
  // field is required and none is optional.
  const base = realizerSilence();
  for (const key of topLevelKeys) {
    const partial: Record<string, unknown> = { ...base };
    delete partial[key];
    assert.equal(realizerDecisionSchema.safeParse(partial).success, false, `missing ${key}`);
  }

  // Nested object fields are also fully required.
  assert.deepEqual(Object.keys(presentMindSchema.shape).sort(), ["primary", "secondary"]);
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, presentMind: { primary: "p" },
  }).success, false, "presentMind missing secondary");
  assert.deepEqual(Object.keys(realityCheckSchema.shape).sort(), ["content", "status"]);
  assert.deepEqual(Object.keys(activeDesireSchema.shape).sort(), ["content", "strength"]);
});

test("presentMind secondary is required and bounded", () => {
  assert.equal(realizerDecisionSchema.safeParse({
    ...realizerSilence(), presentMind: { primary: "p" },
  }).success, false, "missing secondary");
  assert.equal(realizerDecisionSchema.safeParse({
    ...realizerSilence(), presentMind: { primary: "p", secondary: ["a", "b", "c", "d", "e"] },
  }).success, false, "too many secondary entries");
  assert.equal(realizerDecisionSchema.safeParse({
    ...realizerSilence(), presentMind: { primary: "p", secondary: [] },
  }).success, true, "empty secondary is valid");
});

test("realityCheck status none is valid without inventing a second seam", () => {
  const decision = realizerSilence();
  assert.equal(realizerDecisionSchema.safeParse({
    ...decision, realityCheck: { status: "none", content: "No grounded seam here." },
  }).success, true);
});

test("weak activeDesire plus silence is valid and stays a desire", () => {
  const decision: ReturnType<typeof realizerSilence> = {
    ...realizerSilence(),
    activeDesire: { strength: "weak", content: "I want Bob to know his name sounds ridiculous." },
  };
  assert.equal(realizerDecisionSchema.safeParse(decision).success, true);
  assert.equal(decision.activeDesire.strength, "weak");
});

test("weak activeDesire plus speak is valid", () => {
  const decision = realizerSpeak({
    activeDesire: { strength: "weak", content: "I want Bob to know his name sounds ridiculous." },
  });
  assert.equal(realizerDecisionSchema.safeParse(decision).success, true);
});

test("activeDesire none remains valid", () => {
  const decision = realizerSilence();
  assert.equal(decision.activeDesire.strength, "none");
  assert.equal(realizerDecisionSchema.safeParse(decision).success, true);
});

test("speak with null or blank message is invalid", () => {
  const base = realizerSpeak();
  assert.equal(realizerDecisionSchema.safeParse({ ...base, message: null }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({ ...base, message: "   " }).success, false);
});

test("silence with non-null message, address, or reply is invalid", () => {
  const base = realizerSilence();
  assert.equal(realizerDecisionSchema.safeParse({ ...base, message: "ага" }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({ ...base, addressCharacter: "P1" }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({ ...base, replyToMessage: "M1" }).success, false);
});

test("invalid P/M handles are invalid in the dynamic schema", () => {
  const schema = buildRealizerResponseSchema(context.visibleMessages);
  const speak = realizerSpeak();
  assert.equal(schema.safeParse({ ...speak, addressCharacter: "P9" }).success, false);
  assert.equal(schema.safeParse({ ...speak, replyToMessage: "M9" }).success, false);
});

test("malformed structured output is regenerated boundedly, then succeeds", async () => {
  const realizer = realizerWithSequencedResponses([
    { action: "silence" }, // malformed: missing all fields
    realizerSilence(),
  ]);
  const decision = await realizer.realize(context);
  assert.deepEqual(decision, realizerSilence());
});

test("persistent malformed structured output exhausts attempts and rejects", async () => {
  const realizer = realizerWithSequencedResponses([
    { action: "silence" },
    { action: "silence" },
    { action: "silence" },
    { action: "silence" },
  ]);
  await assert.rejects(() => realizer.realize(context), RealizerStructuredOutputError);
});

test("an invalid speak decision is never reinterpreted as valid silence", async () => {
  // A speak decision without a message must fail validation, not become silence.
  const realizer = realizerWithSequencedResponses([
    { ...realizerSpeak(), message: null },
    { ...realizerSpeak(), message: null },
    { ...realizerSpeak(), message: null },
    { ...realizerSpeak(), message: null },
  ]);
  await assert.rejects(() => realizer.realize(context), RealizerStructuredOutputError);
});
