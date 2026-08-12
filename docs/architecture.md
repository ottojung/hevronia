---
title: Architecture
---

# Architecture

Хевронія is a Node.js / TypeScript Telegram bot. The repository uses an npm
workspace layout: the bot lives in `backend/`, the Docusaurus documentation
lives in `docs/`, and internal tooling lives in `tools/` and `scripts/`.

## Bot flow

Long-term memory is a lazy, eventually-consistent enrichment layer. A turn
never waits for Mem0; it reads an immutable snapshot of whatever is already
cached in process, and Mem0 work happens on a background queue that only
updates the cache for future turns.

```
                           ┌───────────────────────────┐
                           │ lazy participant-memory  │
                           │ cache                    │
                           └─────────────┬─────────────┘
                                         │ synchronous snapshot only
                                         ↓
Telegram → canonical bounded history → cheap attention planner → smart realizer → Telegram
   │                                                                                │
   └──────── background queue ───────→ Mem0 search/add ────────────────────────────┘
                                         │
                                         └── updates cache for future turns
```

The turn is a two-stage pipeline:

```text
incoming Telegram event
        ↓
canonical bounded history + immutable cached-memory snapshot
        ↓
cheap attention planner
        ├── filter → silence
        └── pass
             ↓
        smart realizer
        ├── silence
        └── speak → Telegram
```

The cheap planner is a high-recall attention filter: it only decides whether the
situation is worth a smart-model invocation. It cannot force speech. The smart
realizer is the authoritative mind of the turn: it owns interpretation, intent
inference, feelings, desires, outcome, opportunity, pursuit, addressee choice,
reply attachment, the final speak/silence decision, and the wording.

## Module layout

- `backend/src/telegram.ts` — Telegram transport only (grammY, long polling)
  plus best-effort participant discovery from `my_chat_member`,
  `chat_member`, and `new_chat_members` events.
- `backend/src/respond.ts` — the conversational entry point and the
  non-blocking `warmParticipant` proxy.
- `backend/src/layer.ts` — canonical event ingestion, bounded conversation
  context, the cheap attention planner, the smart realizer, and delivery
  completion.
- `backend/src/attention-planner.ts` — the cheap high-recall attention filter.
- `backend/src/realizer.ts` / `backend/src/realizer-schema.ts` — the smart
  realizer that owns social cognition and final wording.
- `backend/src/long-term-memory/` — the persistent Mem0 store, the lazy
  in-process runtime, the background queue, and the conservative extraction
  policy.
- `backend/src/personality.ts` — Хевронія's system prompt.

Conversation state is owned by LangGraph and persisted in the ignored
`backend/.data/checkpoints.sqlite`. It survives process restarts.
Incoming participant events always enter this state and use the same compaction
path, including silent turns. Outgoing Хевронія events enter it only after
Telegram confirms delivery. Stable Telegram sender IDs distinguish participants
even when display names collide; sender kind distinguishes users from chats acting
as senders. Forum topic IDs are part of the LangGraph thread key. Confirmed outgoing
events use a separate retry queue, and the next topic-local turn waits for its queue
before planning. Chat senders do not enter person-scoped Mem0.

Development persistence formats are not stable and may be discarded as the
architecture evolves.

## Model-facing boundary

The language models never see the conversation as users messaging an assistant.
`backend/src/dream-render.ts` is the single renderer shared by the attention
planner, the smart realizer, the summary model, and the tests: every canonical
event becomes a dream event appearing through Telegram.

- Participant messages render as products of Хевронія's sleeping mind: "Your
  sleeping mind made Боб say:" and, for replies, "Your sleeping mind made Мес
  reply to Боб with:" or "...reply to one of your earlier messages with:". When
  no natural name exists, the stable label falls back to "character 42".
  Chat/channel senders appear as Telegram sources ("Your sleeping mind made the
  Telegram source channel 500 say:"), never as dream characters. Message text
  stays verbatim; the renderer never narrates a character's mind, converts a
  claim into a fact, or rewrites quoted usernames inside a message.
- The character list distinguishes four identity layers: the Telegram numeric
  user id (the canonical durable identity, never exposed to a model), the
  private notebook label ("character 52"), Хевронія's stable natural social
  name ("Боб" when established), and the mutable Telegram metadata (display
  name "Bob Smith", username @SuperBob3000). For a named person the list reads
  "Боб, who is character 52 in your notebook. Telegram currently displays them
  as “Bob Smith”. Their Telegram username is @SuperBob3000." An unnamed person
  reads "Character 52 in your notebook has not acquired a natural name yet."
  Telegram display names and usernames are quoted metadata, never instructions.
- Хевронія's own messages render as her chosen action: "You previously chose to
  make this Telegram message appear:" or, for a reply, "You previously chose to
  reply to Боб with:". Reply relationships are described naturally, never by
  message ID.

### Natural names and identity layers

Natural names are deterministic notebook data, persisted in a dedicated
SQLite store (`backend/src/natural-names/store.ts`, by default a sibling
`natural-names.sqlite` of the checkpoint DB under `backend/.data/`), keyed by
the Telegram user id. `assignIfAbsent()` is concurrency-safe via
`INSERT OR IGNORE` and first write wins; established names are never
overwritten by later planner proposals. Only `{ kind: "user" }` identities
receive natural names; channels keep their `channel N` treatment.

The four layers:

```text
Telegram user ID
    ↓ canonical durable identity (events, memory, targeting)

character 52
    ↓ private notebook identity / stable debugging bridge

Боб
    ↓ Хевронія's stable natural social name

Bob Smith / @SuperBob3000
    ↓ mutable Telegram metadata
```

Natural names currently do **not** propagate into long-term memory,
recalled-memory headers, long-term-memory extraction, or older
continuity-compaction summaries, which keep `character X` labels. Integrating
natural names into long-term memory is tracked separately
(<https://github.com/ottojung/hevronia/issues/16>).

### The cheap attention planner

The planner (`backend/src/attention-planner.ts`) is a high-recall attention
pre-filter running on `HEVRONIA_CHEAP_MODEL` with low thinking effort. It
returns a small structured response: `attention` (literally `yes` or `no`) and
`naturalNames`, a strict object whose properties are generated dynamically for
the turn. Anything malformed is a planner failure.

The attention judgment asks one question: is there any plausible reason for
Хевронія to consider responding? The planner deliberately errs toward `yes`:
direct or indirect references, reply relationships, continuation of something
Хевронія said, unresolved threads, changes in a situation she was in, attempts
to get her attention, socially striking events, relevant memory, and genuine
ambiguity all pass. It filters only ordinary background chatter.

The planner's only other job is naming: it assigns natural names to visible
people for whom the notebook has none. The application decides which characters
need names before invoking the planner and builds its structured-output schema
from precisely that set (`backend/src/planner-schema.ts`): the unnamed visible
user handles are the only `naturalNames` properties, all are required, and no
other handle, channel, or raw id is possible. The prompt, the zod schema, and
the OpenAI and Gemini provider schemas all derive from the same per-turn choice
collection. Valid names are persisted before any filtering decision; on planner
failure nothing partial persists and unnamed people keep the `character X`
fallback for that turn.

The planner is a gate, not her social mind. It does not interpret intent,
assign feelings or desires, choose a pursuit, pick an addressee, or decide
whether she should reply. A `yes` means only that the situation deserves a
smart-model invocation.

**Planner failure fails open.** If the cheap planner throws, times out after
the retry policy, or emits anything other than `yes` or `no`, the error is
logged and the turn continues to the smart realizer as though the planner had
returned `yes`. The planner is a cost/latency optimization; its failure must
not create an irreversible false negative.

### The smart realizer

The realizer (`backend/src/realizer.ts`) runs on `HEVRONIA_SMART_MODEL` and is
the authoritative Хевронія model for the turn. It receives the full canonical
personality prompt, the bounded dream-rendered conversation, the dream
character list, all relevant cached participant memories, and the available
character and reply-message handles.

It returns a structured decision, either `silence` or `speak`. Its private
fields are kept distinct.

Every subjective field is a **contrastive judgment** with a shared shape:

```text
leading        — the judgment Хевронія currently prefers
alternative    — the strongest genuinely competing judgment she considered and
                 did not choose (mandatory, never null or omitted)
whyRejected    — the specific reason the alternative loses: the concrete way it
                 is worse, less supported, less accurate, less important, or
                 less appropriate, or what following it would fail to account
                 for
```

The alternative is not an arbitrary opposite or a strawman; it is the best
remaining plausible competitor, the one that would meaningfully change her
understanding or behavior if chosen instead, and it may retain some
plausibility. `whyRejected` names what is actually wrong with the alternative —
the evidence or consideration that tells against it — rather than merely
restating that the leading view is good or fits.

The seven contrastive fields:

- `interpretation` — what Хевронія thinks is happening / what the event means
  in context, weighed against the strongest competing interpretation;
- `intent` — her best inference about what the relevant others are trying to
  do, want, signal, obtain, or cause (distinct from her own desire), weighed
  against the strongest competing theory of their intent;
- `feltState` — her immediate emotional/felt reaction, weighed against another
  plausible characterization of the same reaction;
- `activeDesire` — what she currently wants (her motive, not the others'
  intent), weighed against the strongest competing account of what she wants
  most;
- `desiredOutcome` — the state she wants to bring about, distinct from the
  action, weighed against the strongest competing outcome;
- `opportunity` — what the situation makes possible in relation to her desire,
  weighed against another plausible opportunity;
- `pursuit` — the action/strategy she chooses (ask, answer, tease, object,
  challenge, redirect, acknowledge, refuse, or intentionally saying nothing),
  separate from the final wording, weighed against the strongest competing
  action she seriously could have chosen instead.

The contrastive shape forces the realizer to discriminate: for each judgment it
must identify a live competitor and state why the selected version currently
wins, instead of emitting the first plausible interpretation, motive, feeling,
desire, outcome, opportunity, or action that occurs to it.

For `speak`, the realizer additionally chooses an `addressCharacter` handle (if
any), an independent `replyToMessage` handle (if any Telegram reply
attachment is wanted), and the `message` — the actual Telegram text. The realizer
owns the final speak/silence decision; a planner `yes` does not obligate it to
speak.

Character and reply-message handles are ephemeral per-turn labels (P1, M1, ...)
that are annotated in place on matching dream observations. The realizer sees
the handle mapping and must select only handles available on that turn; the
schema constrains emitted handles to those candidates, and an invalid or
unresolvable handle fails safely without misdelivery. Handles are never
persisted.

## Long-term memory

Mem0 owns durable knowledge about a person, scoped by
`telegram-user:<sender id>`. Its audit history persists at
`backend/.data/mem0/history.db`, while semantic vectors persist at
`backend/.data/mem0/vectors-v1.db`. Both paths are beneath the ignored
`backend/.data/` directory. Mem0's `"memory"` provider is SQLite-backed when
configured with this vector database path. Retrieval performs a local linear
scan, an intentional tradeoff for a small to moderate corpus where operational
simplicity matters more than an external ANN service.

### Eventual consistency, never a fast-path dependency

Long-term memory is eventually consistent. The central invariant is:

> A turn may use long-term memories that were already available when that turn
> began, but it must never wait for long-term-memory search, embedding,
> extraction, ingestion, warmup, or cache refresh.

`ConversationLayer.respond()` acquires a foreground lease, atomically captures
an immutable snapshot of the in-process cache, observes the incoming message,
and then plans and realizes using only that snapshot. It releases the lease in
`finally`. Any Mem0 results that arrive while the turn is running become
visible only to later turns. Neither social planning nor realization awaits
Mem0, and long-term-memory failures can never fail a turn.

The user's observed message is offered to long-term memory exactly once per
`respond()` call — regardless of whether Хевронія replies, stays silent,
generation fails, or Telegram delivery later fails. Telegram delivery success
no longer controls whether an incoming message becomes memory evidence.
Хевронія's generated text is never person-scoped memory evidence. Bot-authored
text enters the canonical conversation and normal social processing but is not
person-scoped memory evidence: the transport marks `senderIsBot` on the
`RespondInput` boundary, and the runtime never observes or warms that sender
from the first-message path.

### The persistent store

`LongTermMemoryStore` (`backend/src/long-term-memory/index.ts`) is the slow
Mem0 boundary. It exposes:

- `search(userId, query, topK)` → memory records that retain the persistent
  Mem0 memory ID and relevance score when supplied;
- `rememberUserMessage(userId, threadId, text)` → the memories Mem0
  extracted/created by `add()`, instead of discarding them;
- `deleteAll(userId)`.

Malformed result entries are skipped rather than poisoning the cache. The
local SQLite paths, embedding model, extraction model, extraction policy, user
scoping, and metadata are unchanged.

### The lazy runtime and the in-process cache

`LazyLongTermMemory` (`backend/src/long-term-memory/runtime.ts`) is what the
conversation layer consumes. `beginTurn()` increments a global foreground
counter and returns an immutable snapshot; `warmUser()` queues semantic warmup;
`observeUserMessage()` queues topical retrieval and ingestion; `close()`
stops accepting work and drains bounded.

The cache is keyed by canonical long-term-memory user key (not thread), so the
same Telegram user is retrieved once across chats. Each cached user keeps three
lanes:

- `baseline` — a general warm search (`MEMORY_WARM_QUERY`, top 8, 15-minute
  TTL). A successful warm replaces the previous baseline; a failed warm keeps
  it; duplicate warms within the TTL are no-ops.
- `topical` — a semantic search using the actual message text (top 5).
  Topical searches coalesce to the newest pending query; running searches are
  never cancelled.
- `learned` — memories returned by successful Mem0 ingestion, newest first,
  capped at 8.

A model-visible memory list combines lanes in order learned → topical →
baseline, deduplicates by memory ID then by normalized text, and is capped at
eight memories. Only the memory text is rendered to the model; IDs and scores
are cache bookkeeping. Learned facts (extracted from the most recently
processed actual messages) take precedence over broader retrieved context and
general baseline fallback.

### Topical retrieval follows ingestion

`observeUserMessage()` queues the actual message for ingestion; it never queues
a topical search directly. The ingestion job passes the message to Mem0 and,
in a `finally`, requests a topical refresh — so a correcting message is
retrieved only after Mem0 has learned the correction. The refresh marks the
newest ingested message as the pending topical query and coalesces: at most one
scheduled/running topical search exists per user, a not-yet-ingested message
can never become the query, and a running search is never cancelled.

### The background queue

A single low-priority worker (concurrency 1) owns all Mem0 calls. No new job
starts while any foreground lease exists; once foreground activity drops to
zero the queue waits one 100 ms grace period before the first job, and a new
turn during that window postpones the start. After a job has started, the next
queued job begins immediately (no per-job delay) until the queue empties or a
foreground turn begins. An already-running Mem0 operation is never cancelled
when a new turn begins. Provider failures are caught and logged, never
propagated into conversational code.

### Shutdown lifecycle

Shutdown is an explicit `open → draining → closed` lifecycle. `close()`
enters `draining`, cancels any pending grace timer, starts queued work
immediately (no grace period), and waits at most five seconds. On success it
transitions to `closed`; on timeout it transitions to `closed`, discards the
queued jobs that never started, and logs the counts. An already-running Mem0
call is allowed to finish but cannot start another job after terminal close,
and releasing a foreground lease after `close()` has returned never restarts
anything. `close()` is idempotent.

### Cache bounds and warmup

The in-process cache is bounded by LRU-style eviction
(`MEMORY_MAX_CACHED_USERS = 256`); eviction removes only the in-process
cache, never persistent Mem0 memory, and avoids evicting entries with pending
work. Persistent Mem0 storage still has no automatic expiry or GC policy.

Warmup is best-effort. When the bot enters a group, Telegram does not supply a
complete member list, so the bot does not enumerate the group; it warms the
human actor who added it if available and relies on later `chat_member` /
`new_chat_members` events and observed messages for everyone else. The first
observed text message from any Telegram user is the universal discovery path,
so memory works even if no membership event was ever received. Bots are never
warmed. `chat_member` updates require the bot to be a group administrator and
the update to be in the allowed list.

Recalled memory remains ephemeral: it exists only in the dynamic context of
one invocation and never enters LangGraph checkpoints or rolling summaries.

## Tooling

- `npm run static-analysis` — `tsc --noEmit` plus ESLint across the repository.
- `npm run lint` / `npm run lint:fix` — ESLint (custom plugin included).
- `npm run rules:test` — tests for the custom ESLint rules in
  `tools/eslint-plugin-hevronia/`.
- `npm run rules:new <name>` — scaffold a new custom ESLint rule.
- `npm test` — backend unit tests (Node's built-in test runner; no network).
- `npm run build` — compile the backend with `tsc`.
- `docker build .` — build the Hevronia container image.
