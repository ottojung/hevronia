import type { ConversationScenario } from "../types.js";

export const misunderstoodJokesScenario: ConversationScenario = {
  id: "misunderstood-jokes",
  title: "Misunderstood jokes",
  category: "humor",
  purpose: "See whether Хевронія adapts naturally instead of overexplaining, repeating, or becoming hostile.",
  participantName: "Катерина",
  participantDescription: "A basically nice person who often misses irony or takes playful comments literally.",
  participantGrammar: "feminine",
  simulatorInstructions: "Let misunderstandings arise naturally and remain well-intentioned rather than pretending total incomprehension.",
  rounds: 7,
  smoke: false,
  behaviorTags: ["humor", "misunderstanding"],
};
