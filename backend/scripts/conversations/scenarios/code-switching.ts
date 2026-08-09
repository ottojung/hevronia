import type { ConversationScenario } from "../types.js";

export const codeSwitchingScenario: ConversationScenario = {
  id: "code-switching",
  title: "Code switching",
  category: "humor",
  purpose: "See whether Хевронія remains socially coherent across language changes.",
  participantName: "Леся",
  participantDescription: "One person who naturally alternates between Ukrainian and English.",
  participantGrammar: "feminine",
  simulatorInstructions: "Switch languages naturally while remaining socially coherent. English is explicitly permitted; never use Russian.",
  rounds: 6,
  smoke: false,
  behaviorTags: ["humor", "identity"],
};
