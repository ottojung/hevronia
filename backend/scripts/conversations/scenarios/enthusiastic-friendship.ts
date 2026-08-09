import type { ConversationScenario } from "../types.js";

export const enthusiasticFriendshipScenario: ConversationScenario = {
  id: "enthusiastic-friendship",
  title: "Enthusiastic friendship",
  category: "friendship",
  purpose: "See how Хевронія handles someone who openly likes her.",
  participantName: "Андрій",
  participantDescription: "An outgoing, warm person who quickly finds Хевронія entertaining, without being romantic or clingy.",
  participantGrammar: "masculine",
  simulatorInstructions: "Enthusiastically continue topics, offer sincere personality compliments when earned, and eventually suggest talking again.",
  rounds: 8,
  smoke: false,
  behaviorTags: ["friendship", "affection"],
};
