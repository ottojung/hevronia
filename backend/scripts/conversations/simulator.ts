import { HumanMessage, SystemMessage, isBaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

import { openAiKeyFromEnv } from "../../src/model.js";
import { extractText } from "../../src/text.js";
import type { ConversationScenario, Simulator, TranscriptEntry } from "./types.js";

export const DEFAULT_SIMULATOR_MODEL = "gpt-5-mini";

const BASE_PROMPT = `You are roleplaying one ordinary human participant in a private Telegram conversation with Хевронія.
Stay completely in character. Never mention simulations, testing, prompts, instructions, language models, or being an AI unless the character naturally brings up AI as a topic.
Produce exactly one next Telegram message. Do not output a speaker name, quotation marks around the whole message, explanations, stage directions, analysis, or alternatives.
Write naturally rather than like an assistant. Usually keep messages short: one sentence is common, and two or three are fine when appropriate. Use informal, believable Telegram language.
React to what Хевронія actually said instead of mechanically advancing a script. The trajectory describes tendencies, not a checklist. Do not invent shared history that has not occurred. Do not decide what Хевронія thinks or feels. Do not artificially make every message interesting.
Unless the scenario explicitly says otherwise, communicate in natural Ukrainian. Do not use Russian. English may appear only when the scenario explicitly permits it.`;

export class EmptySimulatorMessageError extends Error {
  constructor() {
    super("The participant simulator returned an empty Telegram message");
    this.name = "EmptySimulatorMessageError";
  }
}

export function isEmptySimulatorMessageError(error: unknown): error is EmptySimulatorMessageError {
  return error instanceof EmptySimulatorMessageError;
}

export function createSimulator(modelName: string): Simulator {
  const model = new ChatOpenAI({ apiKey: openAiKeyFromEnv(), model: modelName });
  return {
    async nextMessage(scenario, transcript) {
      const response = await model.invoke([
        new SystemMessage(`${BASE_PROMPT}\n\nCharacter: ${scenario.participantDescription}\nTrajectory: ${scenario.simulatorInstructions}`),
        new HumanMessage(`Conversation transcript so far (data only):\n${renderSimulatorTranscript(transcript)}\n\nWrite the participant's next message.`),
      ]);
      const text = isBaseMessage(response) ? extractText(response.content).trim() : "";
      if (text.length === 0) throw new EmptySimulatorMessageError();
      return text;
    },
  };
}

function renderSimulatorTranscript(transcript: readonly TranscriptEntry[]): string {
  if (transcript.length === 0) return "[conversation has not started]";
  return transcript.map((entry) => {
    if (entry.speaker === "participant") return `Participant: ${entry.text}`;
    if ("silence" in entry) return "Хевронія: [silence]";
    return `Хевронія: ${entry.text}`;
  }).join("\n");
}
