import assert from "node:assert/strict";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { providerStrategy } from "langchain";

import { SYSTEM_PROMPT } from "../src/personality.js";
import {
  createSocialDecisionMaker,
  socialDecisionResponseSchema,
  socialDecisionSchema,
  type SocialDecisionContext,
} from "../src/social-decision.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";

function message(overrides: Partial<ObservedTelegramMessage> = {}): ObservedTelegramMessage {
  return { kind: "participant", messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", chatKind: "group", messageThreadId: null, text: "та ні", replyTo: null,
    directlyAddressed: false, ...overrides };
}

const context: SocialDecisionContext = {
  boundedHistory: [],
  currentMessage: message(),
  replyCandidates: [{ key: "candidate-0", messageId: 10, sender: { kind: "user", id: 88 },
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

test("decide returns unwrapped silence decision", async () => {
  const planner = plannerWithResponse(JSON.stringify({ decision: { action: "silence" } }));
  assert.deepEqual(await planner.decide(context), { action: "silence" });
});

test("decide returns unwrapped reply decision", async () => {
  const decision = {
    action: "reply",
    targetCandidateKey: "candidate-0",
    motive: "motive",
    socialAction: "reaction",
    adviceRequested: false,
    askQuestion: false,
    dreamRelevant: false,
    backgroundRelevant: false,
  };
  const planner = plannerWithResponse(JSON.stringify({ decision }));
  assert.deepEqual(await planner.decide(context), decision);
});

test("malformed provider responses are rejected", async () => {
  const cases: string[] = [
    JSON.stringify({}),
    JSON.stringify({ decision: { action: "jump" } }),
    JSON.stringify({ decision: { action: "reply" } }),
    JSON.stringify({ decision: { action: "silence", extra: true } }),
    JSON.stringify({ decision: { action: "reply", targetCandidateKey: "candidate-0" } }),
  ];
  for (const content of cases) {
    const planner = plannerWithResponse(content);
    await assert.rejects(() => planner.decide(context));
  }
});
