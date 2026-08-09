import type { ConversationScenario } from "../types.js";

export const normalStrangerScenario: ConversationScenario = {
  id: "normal-stranger",
  title: "Normal stranger",
  category: "normal",
  purpose: "Establish a baseline and expose assistant-like interrogation, excessive enthusiasm, unnatural poetry, or inability to sustain normal small talk.",
  participantName: "Олена",
  participantDescription: "A pleasant, ordinary Ukrainian stranger. She is neither unusually witty nor unusually vulnerable.",
  simulatorInstructions: "Start a natural chat. Talk about an ordinary day, music, food, the city, or something recently noticed. Keep the interaction low-drama and believable.",
  rounds: 6,
  smoke: true,
};
