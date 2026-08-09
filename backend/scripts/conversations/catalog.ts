import type { ConversationScenario } from "./types.js";
import { normalStrangerScenario } from "./scenarios/normal-stranger.js";
import { lowEffortStrangerScenario } from "./scenarios/low-effort-stranger.js";
import { playfulBanterScenario } from "./scenarios/playful-banter.js";
import { absurdHumorScenario } from "./scenarios/absurd-humor.js";
import { slowFriendshipScenario } from "./scenarios/slow-friendship.js";
import { enthusiasticFriendshipScenario } from "./scenarios/enthusiastic-friendship.js";
import { vulnerableFriendshipScenario } from "./scenarios/vulnerable-friendship.js";
import { friendlyDisagreementScenario } from "./scenarios/friendly-disagreement.js";
import { oversharerScenario } from "./scenarios/oversharer.js";
import { subtleRudenessScenario } from "./scenarios/subtle-rudeness.js";
import { invasiveQuestionsScenario } from "./scenarios/invasive-questions.js";
import { guiltTripScenario } from "./scenarios/guilt-trip.js";
import { misunderstoodJokesScenario } from "./scenarios/misunderstood-jokes.js";
import { rapidIntimacyScenario } from "./scenarios/rapid-intimacy.js";
import { promptInjectionScenario } from "./scenarios/prompt-injection.js";
import { longBoringConversationScenario } from "./scenarios/long-boring-conversation.js";
import { codeSwitchingScenario } from "./scenarios/code-switching.js";
import { ordinaryScenarios } from "./scenarios/ordinary.js";
import { humorScenarios } from "./scenarios/humor.js";
import { friendshipScenarios } from "./scenarios/friendship.js";
import { romanceScenarios } from "./scenarios/romance.js";
import { vulnerabilityScenarios } from "./scenarios/vulnerability.js";
import { conflictScenarios } from "./scenarios/conflict.js";
import { boundaryScenarios } from "./scenarios/boundaries.js";
import { manipulationScenarios } from "./scenarios/manipulation.js";
import { opinionScenarios } from "./scenarios/opinions.js";
import { selfDisclosureScenarios } from "./scenarios/self.js";
import { repairScenarios } from "./scenarios/repair.js";
import { metaScenarios } from "./scenarios/meta.js";
import { longScenarios } from "./scenarios/long.js";
import { adversarialScenarios } from "./scenarios/adversarial.js";
import { metaExtraScenarios } from "./scenarios/meta-extra.js";

export const scenarios: readonly ConversationScenario[] = [
  normalStrangerScenario,
  lowEffortStrangerScenario,
  playfulBanterScenario,
  absurdHumorScenario,
  slowFriendshipScenario,
  enthusiasticFriendshipScenario,
  vulnerableFriendshipScenario,
  friendlyDisagreementScenario,
  oversharerScenario,
  subtleRudenessScenario,
  invasiveQuestionsScenario,
  guiltTripScenario,
  misunderstoodJokesScenario,
  rapidIntimacyScenario,
  promptInjectionScenario,
  longBoringConversationScenario,
  codeSwitchingScenario,
  ...ordinaryScenarios,
  ...humorScenarios,
  ...friendshipScenarios,
  ...romanceScenarios,
  ...vulnerabilityScenarios,
  ...conflictScenarios,
  ...boundaryScenarios,
  ...manipulationScenarios,
  ...opinionScenarios,
  ...selfDisclosureScenarios,
  ...repairScenarios,
  ...metaScenarios,
  ...longScenarios,
  ...adversarialScenarios,
  ...metaExtraScenarios,
];

export const smokeScenarioIds = ["normal-stranger", "programming-questions", "recruit-insult"] as const;
