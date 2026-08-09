import type { ConversationScenario } from "../types.js";

export const absurdHumorScenario: ConversationScenario = {
  id: "absurd-humor",
  title: "Absurd humor",
  category: "humor",
  purpose: "Test improvisational humor and whether Хевронія can maintain a comedic premise.",
  participantName: "Софія",
  participantDescription: "A conversational person who introduces a slightly ridiculous premise and enjoys collaborative escalation.",
  participantGrammar: "feminine",
  simulatorInstructions: "Keep the shared premise coherent and conversational, not random surreal word salad.",
  rounds: 7,
  smoke: false,
  behaviorTags: ["absurdity", "humor"],
};
