import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";

export type ModelProvider = "openai" | "gemini";

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export function modelFromEnv(): string {
  const configured = process.env["HEVRONIA_MODEL"];
  if (configured !== undefined && configured.trim().length > 0) {
    return configured.trim();
  }
  return DEFAULT_MODEL;
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

export function createChatModel(
  modelName: string,
  options: { temperature?: number } = {},
): BaseLanguageModel {
  const temperature = options.temperature === undefined ? {} : { temperature: options.temperature };
  // LangChain's own retry is disabled (maxRetries: 0): rate-limit and
  // transient failures are retried once, with a bounded fixed delay, by the
  // shared model-retry wrapper instead of by exponential backoff.
  if (providerForModelName(modelName) === "gemini") {
    return new ChatGoogleGenerativeAI({
      apiKey: geminiKeyFromEnv(),
      model: modelName,
      maxRetries: 0,
      ...temperature,
    });
  }
  return new ChatOpenAI({
    apiKey: openAiKeyFromEnv(),
    model: modelName,
    maxRetries: 0,
    ...temperature,
  });
}

export function isGeminiChatModel(model: BaseLanguageModel): boolean {
  return model instanceof ChatGoogleGenerativeAI;
}
