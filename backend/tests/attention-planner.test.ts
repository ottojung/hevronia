import assert from "node:assert/strict";
import { test } from "node:test";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import {
  PlannerOutputError,
  createAttentionPlanner,
  parsePlannerOutput,
} from "../src/attention-planner.js";
import type { TurnContext } from "../src/realizer-schema.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";

function message(): ObservedTelegramMessage {
  return { kind: "participant", messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", chatKind: "group", messageThreadId: null, text: "та ні", replyTo: null,
    directlyAddressed: false };
}

const context: TurnContext = {
  boundedHistory: [],
  currentMessage: message(),
  visibleMessages: [{ messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", text: "та ні" }],
  participantMemories: [],
};

function plannerWithResponse(content: string) {
  const model = fakeModel();
  model.respond(new AIMessage(content));
  return createAttentionPlanner(model);
}

test("parsePlannerOutput accepts yes and no with case and whitespace normalization", () => {
  assert.equal(parsePlannerOutput("yes"), true);
  assert.equal(parsePlannerOutput("  YES \n"), true);
  assert.equal(parsePlannerOutput("No"), false);
  assert.equal(parsePlannerOutput(" nO "), false);
});

test("parsePlannerOutput rejects anything other than exactly yes or no", () => {
  for (const bad of ["", "  ", "maybe", "yes and no", "y", "1", "так", "Yes, maybe"]) {
    assert.throws(() => parsePlannerOutput(bad), PlannerOutputError, bad);
  }
});

test("an exact yes answer passes and an exact no answer filters", async () => {
  assert.equal(await plannerWithResponse("yes").consider(context), true);
  assert.equal(await plannerWithResponse("no").consider(context), false);
  assert.equal(await plannerWithResponse("  YES  ").consider(context), true);
  assert.equal(await plannerWithResponse("\nNo\n").consider(context), false);
});

test("a malformed planner answer is a planner failure", async () => {
  await assert.rejects(() => plannerWithResponse("maybe").consider(context), PlannerOutputError);
});

test("a model error from the planner is a planner failure", async () => {
  const model = fakeModel().alwaysThrow(new Error("planner offline"));
  await assert.rejects(() => createAttentionPlanner(model).consider(context), /planner offline/);
});

test("a directly addressed event passes without consulting the model", async () => {
  const addressed = { ...context, currentMessage: { ...context.currentMessage, directlyAddressed: true } };
  const model = fakeModel().alwaysThrow(new Error("must not be called"));
  assert.equal(await createAttentionPlanner(model).consider(addressed), true);
});
