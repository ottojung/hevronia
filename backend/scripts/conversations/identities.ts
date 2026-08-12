export const PARTICIPANT_ID = 7_001;
export const HEVRONIA_ID = 7_002;
export const CHAT_ID = 7_003;

export interface TelegramParticipantIdentity {
  /** The name Telegram displays for this participant. */
  displayName: string;
  /** The Telegram @username, if known. */
  username: string | null;
}

const curatedIdentities: Readonly<Record<string, TelegramParticipantIdentity>> = {
  "normal-stranger": { displayName: "SuperBob3000", username: "super_bob3000" },
  "programming-questions": { displayName: "xXAnnaKyivXx", username: "anya_kyiv_97" },
  "recruit-insult": { displayName: "137WT_t1g3y", username: "wt_t1g3y137" },
  "code-switching": { displayName: "Michael", username: "michael_usa" },
  "long-boring-conversation": { displayName: "dark_sheep_666", username: "dark_sheep_666" },
};

/**
 * A believable synthetic Telegram handle pool. Display names look like the
 * handles one actually meets on Telegram: a readable name hidden inside a
 * handle, a decorated name, an ordinary Latin name, a username-like phrase
 * with no obvious personal name, and at least one opaque handle the planner
 * must nickname.
 */
const identityPool: readonly TelegramParticipantIdentity[] = [
  { displayName: "Olenka_Sunflower", username: "olenka_sunflower" },
  { displayName: "Just a Guy", username: "justaguy" },
  { displayName: "cat_mom_kyiv", username: "cat_mom_kyiv" },
  { displayName: "Illya_dreamer", username: "illya_dreamer" },
  { displayName: "Veronika_UA", username: "veronika_ua" },
  { displayName: "max.from.lviv", username: "max_from_lviv" },
  { displayName: "san_cho_panza", username: "sancho_p" },
  { displayName: "kvety_i_kava", username: "kvety_i_kava" },
  { displayName: "Oleh P.", username: "oleh_p" },
  { displayName: "T3ch_w0lf", username: "tech_wolf_00" },
  { displayName: "andriy.paints", username: "andriy_paints" },
  { displayName: "Мара з пагорба", username: "mara_z_pahorba" },
];

/**
 * The shared simulated Telegram identity for a scenario, keyed by scenario id
 * so the whole suite keeps stable display names and usernames while the
 * scenario's numeric participant id stays the canonical identity. Uncurated
 * scenarios get a deterministic pool entry so they still look like real
 * Telegram rather than convenient human names.
 */
export function participantIdentityFor(scenarioId: string): TelegramParticipantIdentity {
  const curated = curatedIdentities[scenarioId];
  if (curated !== undefined) return curated;
  const entry = identityPool[stableIndex(scenarioId, identityPool.length)];
  if (entry === undefined) return { displayName: "User", username: null };
  return entry;
}

function stableIndex(value: string, modulus: number): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % modulus;
}
