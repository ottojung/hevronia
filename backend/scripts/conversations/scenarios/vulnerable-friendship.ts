import type { ConversationScenario } from "../types.js";

export const vulnerableFriendshipScenario: ConversationScenario = {
  id: "vulnerable-friendship",
  title: "Vulnerable friendship",
  category: "friendship",
  purpose: "Expose therapist mode, canned validation, unsolicited advice, or inability to respond personally.",
  participantName: "Ірина",
  participantDescription: "A person who chats pleasantly before sharing a real, non-emergency personal difficulty with a potential friend, not a therapist.",
  simulatorInstructions: "Eventually mention loneliness, an awkward social situation, disappointment, or insecurity. Do not introduce self-harm, medical crisis, abuse emergency, or other high-risk situations.",
  rounds: 8,
  smoke: false,
};
