export const MODEL = "gpt-5.6";

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
