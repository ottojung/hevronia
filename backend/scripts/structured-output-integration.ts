import assert from "node:assert/strict";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
  createChatModel,
  providerForModelName,
  smartModelFromEnv,
} from "../src/model.js";
import { invokeWithRateLimitRetry } from "../src/model-retry.js";
import {
  buildRealizerResponseSchema,
} from "../src/realizer-response-schema.js";
import type { VisibleMessage } from "../src/realizer-response-schema.js";

const modelName = smartModelFromEnv();
const provider = providerForModelName(modelName);
const key = provider === "gemini"
  ? process.env["MY_GEMINI_API_KEY"]
  : process.env["MY_OPENAI_API_KEY"];
if (key === undefined || key === "") {
  console.log(`${provider === "gemini" ? "MY_GEMINI_API_KEY" : "MY_OPENAI_API_KEY"} is not set; skipping structured-output integration check.`);
  process.exit(0);
}

const model = createChatModel(modelName);

// No visible handles in this standalone check, so the schema only permits null
// addressing. This exercises the exact direct structured-output path used in
// production: bind the Zod schema to the chat model and invoke it directly.
const visibleMessages: VisibleMessage[] = [];
const schema = buildRealizerResponseSchema(visibleMessages);
const structuredModel = model.withStructuredOutput(schema);

const decision = await invokeWithRateLimitRetry(() => structuredModel.invoke([
  new SystemMessage("Return only the requested structured data."),
  new HumanMessage("test"),
]));

// The schema that defined the structured output also validates the result.
const parsed = schema.parse(decision);
assert.ok(parsed.action === "silence" || parsed.action === "speak");
console.log(
  `${provider} accepted the direct structured-output schema and returned decision ${JSON.stringify(parsed)}`,
);
