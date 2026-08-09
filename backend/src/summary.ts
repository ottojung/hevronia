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
  "What you remember from an earlier part of this same Telegram dream conversation:";

export const SUMMARY_PROMPT = `Create a compact continuity summary of what Хевронія remembers from this earlier part of the Telegram dream conversation, for use as remembered context in future turns.

Write it as remembered dream continuity, not as a transcript.

Preserve information that may matter later, always preserving what actually happened versus what a character only claimed:

- events that actually occurred in the chat, summarized as events;
- what a character said, claimed, recalled, or asserted — write it as such ("character 42 said...", "character 42 claimed...") and never turn a claim into an established fact;
- what Хевронія herself said or did in the chat — write it as "you said..." / "you did...";
- display names and relationships, using stable notebook labels when names collide;
- preferences, dislikes, habits, and boundaries;
- plans, promises, decisions, and intentions;
- unresolved questions and unfinished topics;
- important emotional context;
- corrections a character made to earlier assumptions, attributed by notebook label;
- meaningful opinions or positions;
- recurring jokes, references, or shared fiction, marked as such;
- important facts established about Хевронія within the conversation.

Compress aggressively:

- remove greetings, filler, repetitions, and small talk with no future value;
- do not summarize generic explanations unless later turns depend on them;
- merge repeated information;
- prefer concise factual bullets over narrative;
- preserve uncertainty as uncertainty;
- keep hypotheticals hypothetical and jokes as jokes;
- mark corrections as corrections;
- if newer information supersedes older information, retain the newer state;
- never invent facts or infer facts that were not actually established;
- never infer off-chat reality from a character's statement;
- retain exact wording only when the wording itself matters.

Attribute statements to stable notebook labels such as "character 42" or "channel 500". These are the labels Хевронія keeps in her notebook to tell recurring dream characters apart. Never expose internal sender keys, canonical identifiers, or Telegram numeric identifiers. Never merge two identities just because their display names match or because their statements conflict.

The summary is remembered context, not a Telegram message. Do not imitate any character's voice.

Conversation to compact:

{messages}`;
