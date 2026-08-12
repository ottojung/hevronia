import assert from "node:assert/strict";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { providerStrategy } from "langchain";

import { buildGeminiRealizerJsonSchema, buildOpenAiRealizerJsonSchema } from "../src/realizer-json-schema.js";
import { SYSTEM_PROMPT } from "../src/personality.js";
import { createRealizer } from "../src/realizer.js";
import {
  buildRealizerResponseSchema,
  realizerDecisionSchema,
  realizerResponseSchema,
  type TurnContext,
} from "../src/realizer-schema.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";
import { realizerSilence, realizerSpeak } from "./memory-fixtures.js";

function message(overrides: Partial<ObservedTelegramMessage> = {}): ObservedTelegramMessage {
  return { kind: "participant", messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", chatKind: "group", messageThreadId: null, text: "та ні", replyTo: null,
    directlyAddressed: false, ...overrides };
}

const context: TurnContext = {
  boundedHistory: [],
  currentMessage: message(),
  visibleMessages: [{ messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", text: "та ні" }],
  participantMemories: [],
};

function realizerWithResponse(content: string) {
  const model = fakeModel();
  model.respond(new AIMessage(content));
  return createRealizer(model, SYSTEM_PROMPT);
}

function judgment(overrides: { leading?: unknown; alternative?: unknown; whyRejected?: unknown } = {}) {
  return { leading: "l", alternative: "a", whyRejected: "w", ...overrides };
}

test("provider schema root is an object, not a top-level union", () => {
  const providerSchema = providerStrategy(realizerResponseSchema).schema;
  assert.equal(providerSchema["type"], "object");
  assert.ok(providerSchema["properties"]);
  assert.deepEqual(providerSchema["required"], ["decision"]);
  assert.equal(providerSchema["additionalProperties"], false);

  const domainStrategy = providerStrategy(realizerDecisionSchema);
  const domainSchema = domainStrategy.schema;
  assert.equal(domainSchema["type"], undefined);
  assert.ok(domainSchema["anyOf"]);
});

test("realize returns an unwrapped silence decision with the full private state", async () => {
  const silence = realizerSilence();
  const realizer = realizerWithResponse(JSON.stringify({ decision: silence }));
  assert.deepEqual(await realizer.realize(context), silence);
});

test("realize returns an unwrapped speak decision with message and handles", async () => {
  const decision = realizerSpeak({ message: "стій, я зараз" });
  const realizer = realizerWithResponse(JSON.stringify({ decision }));
  assert.deepEqual(await realizer.realize(context), decision);
});

test("the dynamic schema restricts addressCharacter and replyToMessage to visible handles", () => {
  const schema = buildRealizerResponseSchema(context.visibleMessages);
  const speak = realizerSpeak({ addressCharacter: "P1", replyToMessage: "M1" });
  assert.equal(schema.safeParse({ decision: speak }).success, true);
  for (const bad of ["7001", "Юхим", "character 7001", "P9", "M9", "я не братимусь розбирати це"]) {
    assert.equal(schema.safeParse({ decision: { ...speak, addressCharacter: bad } }).success,
      false, `addressCharacter=${bad}`);
    assert.equal(schema.safeParse({ decision: { ...speak, replyToMessage: bad } }).success,
      false, `replyToMessage=${bad}`);
  }
});

type SubjectiveFieldName = "interpretation" | "intent" | "feltState" | "activeDesire"
  | "desiredOutcome" | "opportunity" | "pursuit";
const subjectiveFieldNames: readonly SubjectiveFieldName[] = ["interpretation", "intent",
  "feltState", "activeDesire", "desiredOutcome", "opportunity", "pursuit"];

test("all seven fields carry a full contrastive judgment in both speak and silence", () => {
  for (const decision of [realizerSpeak(), realizerSilence()]) {
    for (const field of subjectiveFieldNames) {
      const value = decision[field];
      assert.equal(typeof value.leading, "string");
      assert.ok(value.leading.length >= 1, `leading of ${field}`);
      assert.equal(typeof value.alternative, "string");
      assert.ok(value.alternative.length >= 1, `alternative of ${field}`);
      assert.equal(typeof value.whyRejected, "string");
      assert.ok(value.whyRejected.length >= 1, `whyRejected of ${field}`);
    }
  }
});

function parseDecision(decision: unknown) {
  return realizerResponseSchema.safeParse({ decision });
}

test("the schema rejects a judgment without an alternative", () => {
  const speak = realizerSpeak();
  const result = parseDecision({ ...speak, intent: judgment({ alternative: undefined }) });
  assert.equal(result.success, false);
});

test("the schema rejects a null alternative", () => {
  const speak = realizerSpeak();
  const result = parseDecision({ ...speak, intent: judgment({ alternative: null }) });
  assert.equal(result.success, false);
});

test("the schema rejects a judgment without whyRejected", () => {
  const speak = realizerSpeak();
  const result = parseDecision({ ...speak, intent: judgment({ whyRejected: undefined }) });
  assert.equal(result.success, false);
});

test("the schema rejects empty judgment strings", () => {
  const speak = realizerSpeak();
  const judgmentParts: readonly ("leading" | "alternative" | "whyRejected")[] =
    ["leading", "alternative", "whyRejected"];
  for (const key of judgmentParts) {
    const result = parseDecision({ ...speak, intent: judgment({ [key]: "   " }) });
    assert.equal(result.success, false, key);
  }
});

test("the schema rejects unexpected keys inside a judgment", () => {
  const speak = realizerSpeak();
  const result = parseDecision({
    ...speak,
    intent: { ...speak.intent, extra: "x" },
  });
  assert.equal(result.success, false);
});

test("a plain string is rejected in place of a judgment", () => {
  const speak = realizerSpeak();
  const result = parseDecision({ ...speak, interpretation: "i" });
  assert.equal(result.success, false);
});

test("the Gemini schema uses enums instead of const and lists the visible handles", () => {
  const schema = buildGeminiRealizerJsonSchema(context.visibleMessages);
  const serialized = JSON.stringify(schema);
  assert.ok(!serialized.includes('"const"'));
  assert.ok(!serialized.includes("additionalProperties"));
  assert.ok(serialized.includes('"enum"'));
  assert.ok(serialized.includes("P1"));
  assert.ok(serialized.includes("M1"));
});

test("the OpenAI schema is fully inlined and strict-compatible", () => {
  const schema = buildOpenAiRealizerJsonSchema(context.visibleMessages);
  const serialized = JSON.stringify(schema);
  assert.ok(!serialized.includes('"$ref"'));
  assert.ok(!serialized.includes('"$defs"'));
  assert.ok(!serialized.includes('"const"'));
  assert.ok(!serialized.includes('"minLength":0'));
  assert.ok(serialized.includes('"additionalProperties":false'));
  assert.ok(serialized.includes('"enum":["silence"]'));
  assert.ok(serialized.includes("P1"));
  assert.ok(serialized.includes("M1"));
});

test("the OpenAI schema keeps additionalProperties off for Gemini but on for OpenAI", () => {
  const geminiSchema = JSON.stringify(buildGeminiRealizerJsonSchema(context.visibleMessages));
  const openAiSchema = JSON.stringify(buildOpenAiRealizerJsonSchema(context.visibleMessages));
  assert.ok(!geminiSchema.includes("additionalProperties"));
  assert.ok(openAiSchema.includes('"additionalProperties":false'));
});

test("the OpenAI provider schema nests the required judgment fields", () => {
  const serialized = JSON.stringify(buildOpenAiRealizerJsonSchema(context.visibleMessages));
  assert.ok(serialized.includes('"leading"'));
  assert.ok(serialized.includes('"alternative"'));
  assert.ok(serialized.includes('"whyRejected"'));
  assert.ok(serialized.includes('"required":["leading","alternative","whyRejected"]'));
  const judgments = (serialized.match(/"required":\["leading","alternative","whyRejected"\]/g) ?? []);
  assert.equal(judgments.length, 14);
});

test("the Gemini provider schema nests the required judgment fields", () => {
  const serialized = JSON.stringify(buildGeminiRealizerJsonSchema(context.visibleMessages));
  assert.ok(serialized.includes('"leading"'));
  assert.ok(serialized.includes('"alternative"'));
  assert.ok(serialized.includes('"whyRejected"'));
  assert.ok(serialized.includes('"required":["leading","alternative","whyRejected"]'));
  const judgments = (serialized.match(/"required":\["leading","alternative","whyRejected"\]/g) ?? []);
  assert.equal(judgments.length, 14);
});

test("malformed provider responses are rejected", async () => {
  const speak = () => realizerSpeak();
  const cases: string[] = [
    JSON.stringify({}),
    JSON.stringify({ decision: { action: "jump" } }),
    JSON.stringify({ decision: { action: "silence" } }),
    JSON.stringify({ decision: { action: "speak" } }),
    JSON.stringify({ decision: { action: "silence", extra: true } }),
    JSON.stringify({ decision: { action: "speak", addressCharacter: "P1" } }),
    // a subjective field must be a contrastive object, not a plain string
    JSON.stringify({ decision: { ...speak(), interpretation: "i" } }),
    // missing Telegram message
    JSON.stringify({ decision: { action: "speak", addressCharacter: "P1",
      replyToMessage: null, interpretation: judgment(), intent: judgment(), feltState: judgment(),
      activeDesire: judgment(), desiredOutcome: judgment(), opportunity: judgment(),
      pursuit: judgment() } }),
    // unexpected key at the decision level
    JSON.stringify({ decision: { ...speak(), targetChoice: "A" } }),
    // unexpected key inside a judgment
    JSON.stringify({ decision: { ...speak(), intent: { ...judgment(), extra: true } } }),
    // missing alternative inside a judgment
    JSON.stringify({ decision: { ...speak(), intent: judgment({ alternative: undefined }) } }),
    // null alternative inside a judgment
    JSON.stringify({ decision: { ...speak(), intent: judgment({ alternative: null }) } }),
    // empty strings inside a judgment
    JSON.stringify({ decision: { ...speak(), intent: judgment({ leading: "" }) } }),
    // invalid handle
    JSON.stringify({ decision: { ...speak(), addressCharacter: "P9" } }),
  ];
  for (const content of cases) {
    const realizer = realizerWithResponse(content);
    await assert.rejects(() => realizer.realize(context));
  }
});
