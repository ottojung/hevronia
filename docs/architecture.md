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
Telegram → canonical bounded history → social decision → realization → Telegram
   │
   └──────── background queue ───────→ Mem0 search/add
                                         │
                                         └── updates cache for future turns
```

## Module layout

- `backend/src/telegram.ts` — Telegram transport only (grammY, long polling)
  plus best-effort participant discovery from `my_chat_member`,
  `chat_member`, and `new_chat_members` events.
- `backend/src/respond.ts` — the conversational entry point and the
  non-blocking `warmParticipant` proxy.
- `backend/src/layer.ts` — canonical event ingestion, bounded conversation
  context, social planning, ephemeral realization, and delivery completion.
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
Хевронія's generated text is never person-scoped memory evidence.

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

A model-visible memory list combines lanes in order topical → learned →
baseline, deduplicates by memory ID then by normalized text, and is capped at
eight memories. Only the memory text is rendered to the model; IDs and scores
are cache bookkeeping.

### The background queue

A single low-priority worker (concurrency 1) owns all Mem0 calls. No new job
starts while any foreground lease exists; once foreground activity drops to
zero the queue waits 100 ms before starting the next job, and a new turn
during that window postpones the start. An already-running Mem0 operation is
never cancelled when a new turn begins. Provider failures are caught and
logged, never propagated into conversational code. Shutdown stops accepting
new jobs and drains for at most five seconds, then logs anything unfinished;
no normal turn ever waits for that drain.

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
