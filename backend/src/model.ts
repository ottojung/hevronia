import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";

export type ModelProvider = "openai" | "gemini";

export const DEFAULT_CHEAP_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_SMART_MODEL = "gemini-3.5-flash-lite";

function configuredModelEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) return undefined;
  return value.trim();
}

export function cheapModelFromEnv(): string {
  return configuredModelEnv("HEVRONIA_CHEAP_MODEL") ?? DEFAULT_CHEAP_MODEL;
}

export function smartModelFromEnv(): string {
  return configuredModelEnv("HEVRONIA_SMART_MODEL") ?? DEFAULT_SMART_MODEL;
}

export function providerForModelName(model: string): ModelProvider {
  return model.trim().toLowerCase().startsWith("gemini") ? "gemini" : "openai";
}

export function openAiKeyFromEnv(): string {
  const apiKey = process.env["MY_OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "MY_OPENAI_API_KEY is not set in the environment. " +
        "Provide the OpenAI API key before using an OpenAI model.",
    );
  }
  return apiKey;
}

export function geminiKeyFromEnv(): string {
  const apiKey = process.env["MY_GEMINI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "MY_GEMINI_API_KEY is not set in the environment. " +
        "Provide the Gemini API key before using a Gemini model.",
    );
  }
  return apiKey;
}

export interface ChatModelOptions {
  temperature?: number;
  /** Reduces thinking effort for cheap, recall-oriented stages. */
  lowThinking?: boolean;
}

export function createChatModel(
  modelName: string,
  options: ChatModelOptions = {},
): BaseChatModel {
  // LangChain's own retry is disabled (maxRetries: 0): rate-limit and
  // transient failures are retried once, with a bounded fixed delay, by the
  // shared model-retry wrapper instead of by exponential backoff.
  if (providerForModelName(modelName) === "gemini") {
    return new ChatGoogleGenerativeAI({
      apiKey: geminiKeyFromEnv(),
      model: modelName,
      maxRetries: 0,
      ...(options.lowThinking === true ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}),
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    });
  }
  return new ChatOpenAI({
    apiKey: openAiKeyFromEnv(),
    model: modelName,
    maxRetries: 0,
    ...(options.lowThinking === true ? { reasoning: { effort: "low" } } : {}),
    ...openAiTemperature(options.temperature),
  });
}

// OpenAI reasoning models (o-series, gpt-5.x) accept only the default
// temperature and reject any explicit value. The deterministic 0 is dropped
// instead of sent; any other value still passes through for classic models.
export function openAiTemperature(temperature: number | undefined): { temperature?: number } {
  if (temperature === undefined || temperature === 0) return {};
  return { temperature };
}

export function isGeminiChatModel(model: BaseLanguageModel): model is ChatGoogleGenerativeAI {
  return model instanceof ChatGoogleGenerativeAI;
}
