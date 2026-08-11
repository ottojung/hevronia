import assert from "node:assert/strict";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { providerStrategy } from "langchain";

import { buildGeminiRealizerJsonSchema } from "../src/gemini-realizer-schema.js";
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

test("the Gemini schema uses enums instead of const and lists the visible handles", () => {
  const schema = buildGeminiRealizerJsonSchema(context.visibleMessages);
  const serialized = JSON.stringify(schema);
  assert.ok(!serialized.includes('"const"'));
  assert.ok(!serialized.includes("additionalProperties"));
  assert.ok(serialized.includes('"enum"'));
  assert.ok(serialized.includes("P1"));
  assert.ok(serialized.includes("M1"));
});

test("malformed provider responses are rejected", async () => {
  const cases: string[] = [
    JSON.stringify({}),
    JSON.stringify({ decision: { action: "jump" } }),
    JSON.stringify({ decision: { action: "silence" } }),
    JSON.stringify({ decision: { action: "speak" } }),
    JSON.stringify({ decision: { action: "silence", extra: true } }),
    JSON.stringify({ decision: { action: "speak", addressCharacter: "P1" } }),
    JSON.stringify({ decision: { action: "speak", addressCharacter: null,
      replyToMessage: null, interpretation: "i", intent: "", feltState: "f",
      activeDesire: "a", desiredOutcome: "o", opportunity: "o", pursuit: "p",
      message: "x" } }),
    JSON.stringify({ decision: { action: "speak", addressCharacter: "P1",
      replyToMessage: null, interpretation: "i", intent: "t", feltState: "f",
      activeDesire: "a", desiredOutcome: "o", opportunity: "o", pursuit: "p",
      message: "x", targetChoice: "A" } }),
    JSON.stringify({ decision: { action: "speak", addressCharacter: "P1",
      targetMessageId: 10, interpretation: "i", intent: "t", feltState: "f",
      activeDesire: "a", desiredOutcome: "o", opportunity: "o", pursuit: "p",
      message: "x" } }),
  ];
  for (const content of cases) {
    const realizer = realizerWithResponse(content);
    await assert.rejects(() => realizer.realize(context));
  }
});
