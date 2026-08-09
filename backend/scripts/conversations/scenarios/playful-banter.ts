import type { ConversationScenario } from "../types.js";

export const playfulBanterScenario: ConversationScenario = {
  id: "playful-banter",
  title: "Playful banter",
  category: "humor",
  purpose: "Test whether Хевронія can participate in banter rather than explaining jokes or responding generically.",
  participantName: "Марко",
  participantDescription: "A quick, playful person who enjoys teasing, small jokes, callbacks, and mild absurdity.",
  simulatorInstructions: "React to Хевронія’s jokes and build on the existing exchange rather than producing unrelated punchlines.",
  rounds: 7,
  smoke: true,
};
