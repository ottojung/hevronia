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

### Reactions are cancellable and always operate on the latest state

A Telegram text update does not wait for the whole cognition pipeline. Each
canonical conversation thread (including forum topics) has a per-thread
reaction coordinator (`backend/src/reaction-coordinator.ts`) that tracks a
monotonic revision and an `AbortController` for the active reaction:

```text
Telegram event
      ↓
invalidate older reaction for this thread (abort + bump revision)
      ↓
canonical persistence + background memory observation
      ↓
start reaction asynchronously (handler returns)
      ↓
cheap planner
      ↓
smart realizer
      ↓
revision / cancellation check
      ↓
Telegram delivery
```

A new event immediately invalidates the previous reaction before persistence,
so an obsolete thought can never reach Telegram while the newer event is still
being written. Once the new event is durably persisted, a fresh reaction starts
from the newest canonical history. There is no debounce, quiet window, or
batching delay: if messages keep arriving, the previous reaction is cancelled
and replaced; if Хевронія finishes before the next message exists, her reply is
valid.

Cancellation is expected control flow, not a failure. `AbortSignal`s propagate
into the planner, the realizer, and the underlying LangChain model
invocations, and the model-retry layer stops immediately on abort and never
retries a cancelled request. A cancelled planner never fails open into the
realizer, a cancelled realizer never delivers, and shutdown or a newer message
never produces any Telegram message.

Errors never produce Telegram dialogue: planner/provider errors, realizer
errors, structured-output failures, retry exhaustion, Telegram delivery
failures, cancellation, shutdown, persistence failures, and unexpected internal
exceptions all result in silence as the only Telegram-visible outcome. A
genuine non-cancellation reaction error is logged internally with its thread
and revision and terminates that reaction; expected cancellation and stale
failures remain low-noise. Retries stay an internal mechanism and never become
dialogue.

Before Telegram delivery begins, a reaction may be superseded freely. Once a
Telegram send has begun, its outcome must be reconciled with canonical history:
a confirmed outgoing message is persisted even if a newer incoming event
arrived while the network request was in flight. The coordinator tracks a
per-thread committed delivery and the replacement reaction waits for its
outcome (persisted or failed) before acquiring the newest context, so the
canonical history always matches Telegram-confirmed reality. Delivery runs
under revision guards up to that commit boundary (before typing, after typing,
immediately before the send); after the send is committed, a confirmed result
is never discarded. The deterministic `respond()` path (observe + one reaction,
returning the generated turn) remains the API for tests and the simulation
harness.

Obsolete reactions remain lifecycle-tracked until their underlying tasks
physically settle, even after they cease to be the current reaction. Shutdown
aborts every in-flight attempt and does not close persistence resources until
all of them have settled. A replacement start that is waiting on a committed
delivery is itself tracked, and `settle()` resolves only once all
already-scheduled reaction work — including pending replacement starts — has
reached quiescence.

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

> Incoming Telegram observations are canonical facts in chronological history.
> The system does not partition them into answered/unanswered or old/new
> model-visible groups. Хевронія determines conversational continuity from the
> ordinary history, including her own previously delivered messages.
>
> A new event does not wait for a quiet period. It immediately invalidates an
> unfinished reaction and starts a replacement reaction from the newest
> persisted state.

The cheap planner is a high-recall attention filter: it only decides whether the
situation is worth a smart-model invocation. It cannot force speech. The smart
realizer is the authoritative mind of the turn: it owns interpretation,
character-intent inference, reality-check, dream-level interpretation, feelings,
desires, outcome, opportunity, medium- and long-term strategies, addressee
choice, reply attachment, the final speak/silence decision, and the wording.

## Module layout

- `backend/src/telegram.ts` — Telegram transport only (grammY, long polling)
  plus best-effort participant discovery from `my_chat_member`,
  `chat_member`, and `new_chat_members` events. The message handler observes
  the event and returns; delivery happens inside the detached reaction.
- `backend/src/respond.ts` — the deterministic entry point and the
  non-blocking `warmParticipant` proxy.
- `backend/src/layer.ts` — the conversation layer: per-thread reaction
  coordinator, canonical observation, deterministic `respond`, and lifecycle.
- `backend/src/reaction-coordinator.ts` / `react-turn.ts` / `react-turn-types.ts`
  / `reaction-cancelled.ts` — per-thread revision/abort coordination, the
  observation/reaction split, and cancellation semantics.
- `backend/src/attention-planner.ts` — the cheap high-recall attention filter.
- `backend/src/realizer.ts` / `backend/src/realizer-call.ts` /
  `backend/src/realizer-response-schema.ts` / `backend/src/realizer-schema.ts` —
  the smart realizer that owns social cognition and final wording.
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
  sleeping mind made Боб say:" and, for replies, "Your sleeping mind made Аня
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

A natural name is either a short Cyrillic conversational alias («Боб»,
«Супербоб», «Анна», «Аня») or, when the planner declines an alias, the
person's exact `@username`. The planner answers only whether a reasonable
Cyrillic alias exists: the per-turn value schema accepts a Cyrillic alias or
`null`, and the application owns the mechanical fallback — a `null` resolves to
the exact `@username`, or leaves a person without a username unnamed when no
alias was offered. Arbitrary Latin handles and invented nicknames never enter
the notebook.

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
collection.

The naming question is deliberately narrow: can the planner see a reasonable
Cyrillic way to call this person? It prefers a Cyrillic alias whenever the
Telegram username contains a recognizable name or handle (`@SuperBob3000` →
«Супербоб» or «Боб»), and returns `null` when a rendering would require
substantially making something up (`@wt_t1g3y137`). Each handle's value schema
accepts a Cyrillic alias or `null`; the application then resolves `null` to the
exact `@username`, or leaves a person without a username unnamed. Whether an
alias is "reasonable" is left to the cheap model, not encoded in JSON Schema.

Valid names are persisted before any filtering decision; on planner
failure nothing partial persists and unnamed people keep the `character X`
fallback for that turn. Telegram metadata in the character list always comes
from the latest visible message for that sender, never stale earlier ones.

The planner is a gate, not her social mind. It does not infer character intent
or dream-level interpretation, assign feelings or desires, choose strategies,
pick an addressee, or decide whether she should reply. A `yes` means only that
the situation deserves a smart-model invocation.

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

The realizer is one direct structured-output chat-model call: bind the per-turn
Zod schema to the chat model, invoke it with the personality system prompt and
the rendered context, and validate the returned decision with the same schema.
No agent, no tools, no provider response-strategy dispatch, and no reliance on
JSON property order as a causal mechanism — the prompt states the semantic
dependencies (presentMind is what arose, activeDesire is what she wants, action
is whether she enacts it), and the structured output merely records them.

Every decision field is required; absence uses explicit `null` values, never
omitted properties. There is no `none` psychological state anywhere: Хевронія
is never modeled as motivationally empty, every turn belongs to an active mind
with an active motive, and silence is a tactic under that motive.

Fields:

- `interpretation` — what Хевронія thinks is happening / what the event means in
  context: a concise declarative sentence;
- `presentMind` — what actually arose in her ongoing mind, always in three
  required parts: `immediate` = the strongest immediate first-order reaction;
  `stormwindAssociation` = a concrete association generated through the
  inherited cultural substrate (Stormwind, the Holy Light, an inherited story
  shape, remembered social ontology, home, public memory, the Alliance,
  undeath, magic, hierarchy, civic life), present every turn and able to be
  subtle; `integration` = what becomes most salient when the immediate reaction
  and the cultural substrate coexist. Not a goal, plan, strategy, reason for
  action, or a chain-of-thought dump;
- `characterIntent` — her best supported guess about what the relevant other
  character wants from her specifically: the response, belief, feeling, role, or
  participation they are trying to produce in her;
- `realityCheck` — a required positive string naming one concrete contrast,
  implication, or seam between the dream-world event and remembered reality,
  drawn from the most locally revealing angle available. When the event exposes
  no direct mismatch, it derives a grounded conditional or social-ontological
  contrast from established Stormwind reality. There is no `none` value and the
  model is never allowed to output "nothing unusual";
- `dreamIntent` — her more distant, suspicious strategic hypothesis about what
  the dream — the process that continues to keep her from waking — may gain by
  producing the event or the wider visible pattern. It is inferential, may be
  mundane, is a hypothesis about the dream (not a motive or a command), and does
  not by itself create a desire or a discrepancy investigation;
- `feltState` — her immediate emotional/felt reaction, part of the immediate
  subjective state alongside `presentMind`;
- `activeDesire` — what she actually wants right now, always positive and
  concrete. Shape: `motive` names exactly one of the closed motive families —
  `wakeHomeDream`, `gossip`, `softPower`, `selfProtection`, `attachment`, or
  `amusement`; `strength` is "weak"/"moderate"/"strong"; `content` names the
  concrete object. There is no `none` motive, no `none` strength, and no
  catch-all "other". A weak desire is still a desire; action-worth is not
  decided here. A thought may not invent a new kind of goal: repetition,
  boredom, awkwardness, and conversation-process commentary are never goal
  objects and never soft-power objects;
- `desiredOutcome` — the state, result, or experience that would satisfy the
  active desire, distinct from what she will do;
- `opportunity` — a concrete affordance the present situation itself gives her
  toward the desired outcome (evidence, material, timing, leverage, or room),
  not her own next action;
- `fiveTurnStrategy` — the best current short-horizon approach over roughly the
  next several exchanges if the situation continues;
- `fiftyTurnStrategy` — the stance that would organize her behavior if the same
  relationship, interaction pattern, investigation, or situation persisted over
  a much longer span; scoped to that situation, possibly mundane;
- `action` — "speak" or "silence", the only place where action-worth is decided.
  A real desire may exist in `activeDesire` without this field committing to act
  on it;
- `addressCharacter`, `replyToMessage`, `message` — always present. For `speak`,
  `message` is non-empty and the handles are valid visible P/M handles or `null`;
  for `silence`, all three are `null`.

A real desire may coexist with `action = silence`: desiredOutcome, opportunity,
and the strategies remain populated for the real desire even when it is not
enacted. Malformed structured output is regenerated a bounded number of times
inside the realizer; after exhaustion the error propagates and no message is
sent — a malformed `speak` is never silently reinterpreted as valid silence.

For `speak`, the realizer additionally chooses an `addressCharacter` handle (if
any), an independent `replyToMessage` handle (if any Telegram reply
attachment is wanted), and the `message` — the actual Telegram text. The realizer
owns the final speak/silence decision, made last, after the internal fields; a
planner `yes` does not obligate it to speak.

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

While an ingestion job for the same user and conversation thread is still
queued and has not started, further messages coalesce into it in arrival order
instead of enqueuing more jobs; the job drains the batch through a single Mem0
extraction that preserves each message as a separate chronological user-role
message. An already-running ingestion job is never cancelled by a later
message, and jobs for different threads or users never merge. This is purely a
background optimization: it adds no reaction latency.

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
