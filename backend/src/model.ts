export const DEFAULT_MODEL = "gpt-5.6-luna";

export function modelFromEnv(): string {
  const configured = process.env["HEVRONIA_MODEL"];
  if (configured !== undefined && configured.trim().length > 0) {
    return configured.trim();
  }
  return DEFAULT_MODEL;
}

export function openAiKeyFromEnv(): string {
  const apiKey = process.env["MY_OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "MY_OPENAI_API_KEY is not set in the environment. " +
        "Provide the OpenAI API key before starting the bot.",
    );
  }
  return apiKey;
}
