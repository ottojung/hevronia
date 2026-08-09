import assert from "node:assert/strict";

import { AIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, providerStrategy } from "langchain";

import { modelFromEnv } from "../src/model.js";
import {
  socialDecisionResponseSchema,
} from "../src/social-decision.js";

const apiKey = process.env["MY_OPENAI_API_KEY"];
if (apiKey === undefined || apiKey === "") {
  console.log("MY_OPENAI_API_KEY is not set; skipping structured-output integration check.");
  process.exit(0);
}

const model = new ChatOpenAI({ apiKey, model: modelFromEnv() });
const agent = createAgent({
  model,
  tools: [],
  systemPrompt: "Return only the requested structured data.",
  responseFormat: providerStrategy(socialDecisionResponseSchema),
});

const result = await agent.invoke({
  messages: [new AIMessage("test")],
});
const parsed = socialDecisionResponseSchema.parse(result.structuredResponse);
assert.ok(parsed.decision.action === "silence" || parsed.decision.action === "reply");
console.log(
  `OpenAI accepted the provider schema and returned decision ${JSON.stringify(parsed.decision)}`,
);
