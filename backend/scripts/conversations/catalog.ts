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

export const scenarios = [
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
] as const;

export const smokeScenarioIds = ["normal-stranger", "playful-banter", "slow-friendship", "subtle-rudeness"] as const;
