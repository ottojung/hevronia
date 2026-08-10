import assert from "node:assert/strict";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { providerStrategy } from "langchain";

import { SYSTEM_PROMPT } from "../src/personality.js";
import {
  buildSocialDecisionResponseSchema,
  createSocialDecisionMaker,
  socialDecisionResponseSchema,
  socialDecisionSchema,
  type SocialDecisionContext,
} from "../src/social-decision.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";
import { silenceDecision } from "./memory-fixtures.js";

function message(overrides: Partial<ObservedTelegramMessage> = {}): ObservedTelegramMessage {
  return { kind: "participant", messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", chatKind: "group", messageThreadId: null, text: "та ні", replyTo: null,
    directlyAddressed: false, ...overrides };
}

const context: SocialDecisionContext = {
  boundedHistory: [],
  currentMessage: message(),
  visibleMessages: [{ messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", text: "та ні" }],
  participantMemories: [],
};

function plannerWithResponse(content: string) {
  const model = fakeModel();
  model.respond(new AIMessage(content));
  return createSocialDecisionMaker(model, SYSTEM_PROMPT);
}

test("provider schema root is an object, not a top-level union", () => {
  const providerSchema = providerStrategy(socialDecisionResponseSchema).schema;
  assert.equal(providerSchema["type"], "object");
  assert.ok(providerSchema["properties"]);
  assert.deepEqual(providerSchema["required"], ["decision"]);
  assert.equal(providerSchema["additionalProperties"], false);

  const domainStrategy = providerStrategy(socialDecisionSchema);
  const domainSchema = domainStrategy.schema;
  assert.equal(domainSchema["type"], undefined);
  assert.ok(domainSchema["anyOf"]);
});

test("decide returns unwrapped silence decision with the full private state", async () => {
  const silence = silenceDecision();
  const planner = plannerWithResponse(JSON.stringify({ decision: silence }));
  assert.deepEqual(await planner.decide(context), silence);
});

test("decide returns unwrapped speak decision", async () => {
  const decision = {
    action: "speak",
    addressCharacter: "P1",
    replyToMessage: null,
    interpretation: "This character is asking me for a favour.",
    feltState: "This leaves you mildly interested in what they need.",
    activeDesire: "You want to understand what they actually want.",
    desiredOutcome: "You want to know enough to decide whether it matters to you.",
    opportunity: "You notice the present interaction gives you room to ask.",
    pursuit: "You decide to ask a direct question.",
  };
  const planner = plannerWithResponse(JSON.stringify({ decision }));
  assert.deepEqual(await planner.decide(context), decision);
});

test("the dynamic schema restricts addressCharacter and replyToMessage to visible handles", () => {
  const schema = buildSocialDecisionResponseSchema(context.visibleMessages);
  const speak = { action: "speak", addressCharacter: "P1", replyToMessage: "M1",
    interpretation: "i", feltState: "f", activeDesire: "a", desiredOutcome: "o",
    opportunity: "o", pursuit: "p" };
  assert.equal(schema.safeParse({ decision: speak }).success, true);
  for (const bad of ["7001", "Юхим", "character 7001", "P9", "M9", "я не братимусь розбирати це"]) {
    assert.equal(schema.safeParse({ decision: { ...speak, addressCharacter: bad } }).success,
      false, `addressCharacter=${bad}`);
    assert.equal(schema.safeParse({ decision: { ...speak, replyToMessage: bad } }).success,
      false, `replyToMessage=${bad}`);
  }
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
      replyToMessage: null, interpretation: "", feltState: "f", activeDesire: "a",
      desiredOutcome: "o", opportunity: "o", pursuit: "p" } }),
    JSON.stringify({ decision: { action: "speak", addressCharacter: "P1",
      replyToMessage: null, interpretation: "i", feltState: "f", activeDesire: "a",
      desiredOutcome: "o", opportunity: "o", pursuit: "p", targetChoice: "A" } }),
    JSON.stringify({ decision: { action: "speak", addressCharacter: "P1",
      targetMessageId: 10, interpretation: "i", feltState: "f", activeDesire: "a",
      desiredOutcome: "o", opportunity: "o", pursuit: "p" } }),
  ];
  for (const content of cases) {
    const planner = plannerWithResponse(content);
    await assert.rejects(() => planner.decide(context));
  }
});
