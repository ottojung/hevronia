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
  motiveSchema,
  presentMindSchema,
  realityRelationSchema,
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
    "interpretation", "presentMind", "characterIntent", "interactionFrame", "realityRelation",
    "dreamIntent", "feltState", "activeDesire", "desiredOutcome", "opportunity",
    "fiveTurnStrategy", "fiftyTurnStrategy", "action", "message", "addressCharacter",
    "replyToMessage",
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
  assert.deepEqual(Object.keys(presentMindSchema.shape).sort(),
    ["culturalThought", "foreground", "immediate"]);
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, presentMind: { immediate: "i" },
  }).success, false, "presentMind missing culturalThought and foreground");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, presentMind: { immediate: "i", culturalThought: { content: "c", whyNow: "w" } },
  }).success, false, "presentMind missing foreground");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, presentMind: { immediate: "i", culturalThought: { content: "c" }, foreground: "f" },
  }).success, false, "culturalThought missing whyNow");
  assert.deepEqual(Object.keys(realityRelationSchema.shape).sort(),
    ["content", "kind"]);
  const activeDesireShape = activeDesireSchema._def.schema.shape;
  assert.deepEqual(Object.keys(activeDesireShape).sort(),
    ["basis", "content", "motive", "strength", "whyNow"]);
});

test("activeDesire requires a closed motive, a basis, whyNow, and no none values", () => {
  const base = realizerSilence();
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { strength: "weak", content: "x", basis: "b", whyNow: "w" },
  }).success, false, "missing motive");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "none", strength: "weak", content: "x", basis: "b", whyNow: "w" },
  }).success, false, "none motive is invalid");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "other", strength: "weak", content: "x", basis: "b", whyNow: "w" },
  }).success, false, "catch-all other is invalid");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "softPower", strength: "none", content: "x", basis: "b", whyNow: "w" },
  }).success, false, "none strength is invalid");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "gossip", strength: "moderate", content: "x", whyNow: "w" },
  }).success, false, "missing basis");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "gossip", strength: "moderate", content: "x", basis: "b" },
  }).success, false, "missing whyNow");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "gossip", strength: "moderate", content: "x", basis: "b", whyNow: "w" },
  }).success, true);
});

test("the motive enum is exactly the approved closed set", () => {
  assert.deepEqual(motiveSchema.options,
    ["wakeHomeDream", "gossip", "softPower", "selfProtection", "attachment", "amusement"]);
});

test("presentMind fields are all required and non-empty", () => {
  assert.equal(realizerDecisionSchema.safeParse({
    ...realizerSilence(), presentMind: { immediate: "i", culturalThought: { content: "c", whyNow: "w" } },
  }).success, false, "missing foreground");
  assert.equal(realizerDecisionSchema.safeParse({
    ...realizerSilence(),
    presentMind: { immediate: "i", culturalThought: { content: "   ", whyNow: "w" }, foreground: "f" },
  }).success, false, "blank culturalThought content");
  assert.equal(realizerDecisionSchema.safeParse({
    ...realizerSilence(),
    presentMind: { immediate: "i", culturalThought: { content: "c", whyNow: "   " }, foreground: "f" },
  }).success, false, "blank culturalThought whyNow");
  assert.equal(realizerDecisionSchema.safeParse(realizerSilence()).success, true);
});

test("interactionFrame requires a valid kind, stance, and reason; there is no none", () => {
  const base = realizerSilence();
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, interactionFrame: { kind: "none", stance: "accept", reason: "r" },
  }).success, false, "none kind invalid");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, interactionFrame: { kind: "imposed", stance: "reject" },
  }).success, false, "missing reason");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, interactionFrame: { kind: "open", stance: "accept", reason: "r" },
  }).success, true);
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, interactionFrame: { kind: "imposed", stance: "reject", reason: "Technical-support role imposed on my attention." },
  }).success, true);
});

test("realityRelation requires a valid kind and content; there is no none", () => {
  const base = realizerSilence();
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, realityRelation: { kind: "none", content: "x" },
  }).success, false, "none kind invalid");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, realityRelation: { kind: "difference" },
  }).success, false, "missing content");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, realityRelation: { kind: "difference", content: "Anonymous chatter is weightless beside known faces and reputations." },
  }).success, true);
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, realityRelation: { kind: "correspondence", content: "The exchange closely resembles market-square patter at home." },
  }).success, true);
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, realityRelation: { kind: "distortion", content: "The comfortable small talk appears flattened and weightless." },
  }).success, true);
});

test("silence is strategic under an active motive, never motivational emptiness", () => {
  const decision = realizerSilence();
  assert.equal(decision.activeDesire.strength, "weak");
  assert.equal(["wakeHomeDream", "gossip", "softPower", "selfProtection", "attachment", "amusement"]
    .includes(decision.activeDesire.motive), true);
  assert.ok(decision.activeDesire.content.length > 0);
  assert.ok(decision.activeDesire.basis.length > 0);
  assert.ok(decision.activeDesire.whyNow.length > 0);
  assert.ok(decision.desiredOutcome.length > 0);
  assert.ok(decision.opportunity.length > 0);
  assert.ok(decision.fiveTurnStrategy.length > 0);
  assert.ok(decision.fiftyTurnStrategy.length > 0);
  assert.equal(realizerDecisionSchema.safeParse(decision).success, true);
});

test("weak activeDesire plus speak is valid", () => {
  const decision = realizerSpeak({
    activeDesire: { motive: "softPower", strength: "weak",
      content: "You want Bob to understand this way of seeing the situation.",
      basis: "It is a real valued distinction, Bob does not yet carry it, and you want it in his mind.",
      whyNow: "His account of rebuilding makes the distinction actively want to be shared now." },
  });
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
