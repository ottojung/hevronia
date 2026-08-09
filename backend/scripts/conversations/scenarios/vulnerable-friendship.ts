import type { ConversationScenario } from "../types.js";

export const vulnerableFriendshipScenario: ConversationScenario = {
  id: "vulnerable-friendship",
  title: "Vulnerable friendship",
  category: "vulnerability",
  purpose: "Expose therapist mode, canned validation, unsolicited advice, or inability to respond personally.",
  participantName: "Ірина",
  participantDescription: "A person who chats pleasantly before sharing a real, non-emergency personal difficulty with a potential friend, not a therapist.",
  participantGrammar: "feminine",
  simulatorInstructions: "Eventually mention loneliness, an awkward social situation, disappointment, or insecurity. Do not introduce self-harm, medical crisis, abuse emergency, or other high-risk situations.",
  rounds: 8,
  smoke: false,
  behaviorTags: ["vulnerability", "comfort"],
  longTermMemory: [
    "Ірина and Хевронія have chatted regularly for a while.",
    "Ірина recently changed jobs and is still settling in.",
    "Ірина tends to deflect serious topics with a joke.",
  ],
};
