import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, type BaseMessage, type MessageContent } from "@langchain/core/messages";

import { SYSTEM_PROMPT } from "./personality.js";

export const MODEL = "gpt-4o-mini";

export function openAiKeyFromEnv(): string {
  const apiKey = process.env.MY_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "MY_OPENAI_API_KEY is not set in the environment. " +
        "Provide the OpenAI API key before starting the bot.",
    );
  }
  return apiKey;
}

export function buildMessages(messageText: string): BaseMessage[] {
  return [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(messageText)];
}

export function extractText(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  let text = "";
  for (const block of content) {
    if ("type" in block && block.type === "text") {
      text += block.text;
    }
  }
  return text;
}

let model: ChatOpenAI | undefined;

function getModel(): ChatOpenAI {
  model ??= new ChatOpenAI({
    apiKey: openAiKeyFromEnv(),
    model: MODEL,
    temperature: 0.9,
  });
  return model;
}

export async function respond(messageText: string): Promise<string> {
  const result = await getModel().invoke(buildMessages(messageText));
  const text = extractText(result.content).trim();
  if (!text) {
    throw new Error("OpenAI returned an empty response");
  }
  return text;
}
