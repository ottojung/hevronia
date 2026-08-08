import { fileURLToPath } from "node:url";

export const COMPACTION: {
  triggerTokens: number;
  keepTokens: number;
  trimTokensToSummarize: number;
} = {
  triggerTokens: 12_000,
  keepTokens: 4_000,
  trimTokensToSummarize: 10_000,
};

const DEFAULT_DB_PATH = fileURLToPath(
  new URL("../.data/checkpoints.sqlite", import.meta.url),
);

export { DEFAULT_DB_PATH };

export const SUMMARY_PREFIX =
  "Earlier conversation summary. Newer verbatim messages take precedence if they conflict:";

export const SUMMARY_PROMPT = `Create a compact continuity summary of the earlier portion of this Telegram conversation for use as context in future turns.

Preserve information that may matter later:

- concrete facts established by any participant, always attributed to that
  participant's canonical stable Telegram sender identity;
- display names and relationships, retaining stable identifiers when names collide;
- preferences, dislikes, habits, and boundaries;
- plans, promises, decisions, and intentions;
- unresolved questions and unfinished topics;
- important emotional context;
- corrections a participant made to earlier assumptions, attributed by stable identifier;
- meaningful opinions or positions;
- recurring jokes, references, or conversational context that would otherwise become confusing;
- important facts established about Хевронія within the conversation.

Compress aggressively:

- remove greetings, filler, repetitions, and small talk with no future value;
- do not summarize generic explanations unless later turns depend on them;
- merge repeated information;
- prefer concise factual bullets over narrative;
- preserve uncertainty as uncertainty;
- if newer information supersedes older information, retain the newer state;
- never invent facts or infer facts that were not actually established;
- distinguish hypothetical statements from actual facts;
- retain exact wording only when the wording itself matters.

For every sender-specific preference, correction, plan, emotional context,
relationship, unfinished thread, or opinion, retain the original canonical sender
kind and ID exactly: telegram-user:<id> for a user or telegram-chat:<id> for a chat
or channel sender. Never convert one kind into the other. Never merge senders
because their display names match or because their statements conflict.

The summary is internal memory, not a Telegram message. Do not imitate any participant's voice.

Conversation to compact:

{messages}`;
