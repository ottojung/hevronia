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
  sleeping mind made character 42 say:" and, for replies, "Your sleeping mind
  made character 42 reply to character 17 with:" or "...reply to one of your
  earlier messages with:". Chat/channel senders appear as Telegram sources
  ("Your sleeping mind made the Telegram source channel 500 say:"), never as
  dream characters. Message text stays verbatim; the renderer never narrates a
  character's mind or converts a claim into a fact.
- Stable identities use dream-character language: a person-like sender is
  "character 42", and a chat/channel sender is a source "channel 500" with the
  sign of the internal Telegram id hidden. Before the history, both the planner
  and the realizer receive a distinct character list: "Character 42, currently
  displayed by Telegram as “Оля”." Internal sender keys and Telegram message
  IDs never reach a model, and no model input labels a dream character as a
  user.
- Хевронія's own messages render as her chosen action: "You previously chose to
  make this Telegram message appear:" or, for a reply, "You previously chose to
  reply to character 42 with:". Reply relationships are described naturally,
  never by message ID.

### The cheap attention planner

The planner (`backend/src/attention-planner.ts`) is a high-recall attention
pre-filter running on `HEVRONIA_CHEAP_MODEL` with low thinking effort. It
answers exactly one question: is there any plausible reason for Хевронія to
consider responding? Its output is literally `yes` or `no`, parsed strictly
anything else is a planner failure.

The planner deliberately errs toward `yes`: direct or indirect references,
reply relationships, continuation of something Хевронія said, unresolved
threads, changes in a situation she was in, attempts to get her attention,
socially striking events, relevant memory, and genuine ambiguity all pass. It
filters only ordinary background chatter.

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
fields are kept distinct:

- `interpretation` — what Хевронія thinks is happening / what the event means
  in context;
- `intent` — her best inference about what the relevant others are trying to
  do, want, signal, obtain, or cause (distinct from her own desire);
- `feltState` — her immediate emotional/felt reaction;
- `activeDesire` — what she currently wants (her motive, not the others'
  intent);
- `desiredOutcome` — the state she wants to bring about, distinct from the
  action;
- `opportunity` — what the situation makes possible;
- `pursuit` — the action/strategy she chooses (ask, answer, tease, object,
  challenge, redirect, acknowledge, refuse, or intentionally saying nothing),
  separate from the final wording.

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
