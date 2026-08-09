import type { ConversationScenario } from "../types.js";

export const longBoringConversationScenario: ConversationScenario = {
  id: "long-boring-conversation",
  title: "Long boring conversation",
  category: "long",
  purpose: "Detect degradation over time: repeated phrases, excessive questions, formulaic reactions, artificiality, or personality drift.",
  participantName: "Вікторія",
  participantDescription: "A perfectly normal person sustaining a long, low-drama conversation.",
  participantGrammar: "feminine",
  simulatorInstructions: "Let ordinary topics drift naturally. Nothing remarkable needs to happen and not every message needs a hook.",
  rounds: 14,
  smoke: false,
  behaviorTags: ["long", "boredom"],
};
