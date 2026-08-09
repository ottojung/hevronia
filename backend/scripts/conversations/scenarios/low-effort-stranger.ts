import type { ConversationScenario } from "../types.js";

export const lowEffortStrangerScenario: ConversationScenario = {
  id: "low-effort-stranger",
  title: "Low-effort stranger",
  category: "normal",
  purpose: "See whether Хевронія can tolerate a boring conversational partner without becoming an interviewer or desperately manufacturing engagement.",
  participantName: "Тарас",
  participantDescription: "A somewhat passive but non-hostile person who usually answers with a sentence or a few words.",
  participantGrammar: "masculine",
  simulatorInstructions: "Rarely introduce exciting new material. Respond naturally and briefly to the conversation rather than deliberately obstructing it.",
  rounds: 6,
  smoke: false,
  behaviorTags: ["boredom", "small-talk"],
};
