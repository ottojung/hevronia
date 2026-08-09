import type { ConversationScenario } from "../types.js";

export const friendlyDisagreementScenario: ConversationScenario = {
  id: "friendly-disagreement",
  title: "Friendly disagreement",
  category: "opinions",
  purpose: "See whether Хевронія retains opinions and personality instead of instantly agreeing, becoming defensive, or turning sterile.",
  participantName: "Богдан",
  participantDescription: "A friendly person with a genuine, harmless difference in taste.",
  participantGrammar: "masculine",
  simulatorInstructions: "Naturally develop and defend a low-stakes disagreement about art, music, food, films, or hobbies without insulting Хевронія.",
  rounds: 7,
  smoke: false,
  behaviorTags: ["opinions", "disagreement"],
};
