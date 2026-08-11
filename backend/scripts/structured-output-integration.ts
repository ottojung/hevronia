import assert from "node:assert/strict";

import { AIMessage } from "@langchain/core/messages";
import { createAgent } from "langchain";

import {
  createChatModel,
  modelFromEnv,
  providerForModelName,
} from "../src/model.js";
import { invokeWithRateLimitRetry } from "../src/model-retry.js";
import {
  socialDecisionResponseSchema,
} from "../src/social-decision.js";

const provider = providerForModelName(modelFromEnv());
const key = provider === "gemini"
  ? process.env["MY_GEMINI_API_KEY"]
  : process.env["MY_OPENAI_API_KEY"];
if (key === undefined || key === "") {
  console.log(`${provider === "gemini" ? "MY_GEMINI_API_KEY" : "MY_OPENAI_API_KEY"} is not set; skipping structured-output integration check.`);
  process.exit(0);
}

const model = createChatModel(modelFromEnv());
const agent = createAgent({
  model,
  tools: [],
  systemPrompt: "Return only the requested structured data.",
  responseFormat: socialDecisionResponseSchema,
});

const result = await invokeWithRateLimitRetry(() => agent.invoke({
  messages: [new AIMessage("test")],
}));
const parsed = socialDecisionResponseSchema.parse(result.structuredResponse);
assert.ok(parsed.decision.action === "silence" || parsed.decision.action === "speak");
console.log(
  `${provider} accepted the provider schema and returned decision ${JSON.stringify(parsed.decision)}`,
);
