# Хевронія (@hevronia_bot)

A Telegram bot for Хевронія, a fictional Ukrainian woman. The bot connects to
Telegram over **long polling** via **grammY**, and generates each reply with an
**OpenAI chat model** through **LangChain** (`@langchain/openai`).

Every private or group Telegram chat has a durable LangGraph conversational thread.
Recent messages remain verbatim and older history becomes a rolling summary.
Separately, Mem0 extracts durable facts from user messages after successful delivery and semantically
recalls a small relevant set for the Telegram user in future conversations.

```
Telegram private/group chat
    ├── thread_id → LangGraph recent messages + rolling summary
    └── user_id   → lazy in-process memory cache snapshot (top 8)
                              │
                              ▼
                   social decision → realization → OpenAI → response
                              │
                              ▼
             background queue → Mem0 search/add → SQLite vectors
             backend/.data/mem0/vectors-v1.db  →  updates cache for later turns
```

## Repository structure

```text
hevronia/
├── backend/                # the Telegram bot (npm workspace)
│   ├── src/                # bot source (TypeScript)
│   └── tests/              # unit tests (Node built-in test runner)
├── docs/                   # Docusaurus documentation (npm workspace)
├── scripts/                # development / install / CI helper scripts
├── tools/
│   └── eslint-plugin-hevronia/  # custom internal ESLint plugin
├── .github/workflows/      # CI / automation
├── Dockerfile
├── Makefile
├── eslint.config.mjs
├── package.json            # workspace root
└── tsconfig.json
```

## Prerequisites

- Node.js >= 22.13
- npm

## Installation

```bash
npm install
```

## Configuration

The bot reads secrets from the environment:

```text
TELEGRAM_BOT_TOKEN
MY_OPENAI_API_KEY
MY_GEMINI_API_KEY
```

- `TELEGRAM_BOT_TOKEN` is used for Telegram (grammY).
- `MY_OPENAI_API_KEY` is passed explicitly to the LangChain `ChatOpenAI`
  integration and to Mem0's OpenAI embedder. `OPENAI_API_KEY` is neither
  expected nor used.
- `MY_GEMINI_API_KEY` is used whenever a Gemini model is selected — for the
  chat model and for Mem0's extraction LLM — so it is required at startup
  regardless of which model `HEVRONIA_MODEL` names.

Models are selected through two tiers, read from the environment:

```text
HEVRONIA_CHEAP_MODEL (optional, defaults to gemini-3.5-flash-lite)
HEVRONIA_SMART_MODEL (optional, defaults to gemini-3.5-flash-lite)
```

- `HEVRONIA_SMART_MODEL` is the default response model (the fallback used when
  `HEVRONIA_MODEL` is unset).
- `HEVRONIA_CHEAP_MODEL` is the default for the participant simulator and for
  Mem0's long-term-memory extraction.

`HEVRONIA_MODEL` (optional) overrides the response model directly, and
`HEVRONIA_SIMULATOR_MODEL` (optional) overrides the simulator's participant
model. A model name starting with `gemini` uses the Gemini provider
(`MY_GEMINI_API_KEY`); any other name uses the OpenAI provider
(`MY_OPENAI_API_KEY`). Both providers share the same character and planner
pipeline:

```bash
HEVRONIA_MODEL=gpt-5.6-luna npm run conversations -- --smoke
HEVRONIA_MODEL=gemini-3.5-flash npm run conversations -- --smoke
```

Every model call (planner, realizer, summarizer, and simulator) is retried when
the provider rate-limits us or a transient transport failure occurs. The
providers' built-in exponential retries are disabled (`maxRetries: 0`); the
shared wrapper instead keeps retrying with the provider's suggested delay
(OpenAI `Retry-After` / Google `retryDelay`, capped at 24 hours) or a fixed
two-second wait — never exponential backoff and with no attempt limit.

The bot must be able to observe ambient group conversation. In BotFather, use
`/setprivacy` for `@hevronia_bot` and **disable Group Privacy Mode**. Telegram
may require removing and re-adding the bot to existing groups after this change.
Startup fails with a clear diagnostic when `getMe()` does not report
`can_read_all_group_messages`, rather than silently running without ambient messages.

The bot fails fast at startup if either variable is absent. Secrets are never
printed, logged, or stored, and should never be committed.

In the normal working environment both variables are already provided through
`$MIYKA_PROJ_PATH/env`. If they are not loaded into your shell yet:

```bash
. "$MIYKA_PROJ_PATH/env"
```

## Running locally

```bash
npm run dev        # development (tsx watch, no build step)
```

or, for the compiled build:

```bash
npm run build
npm start
```

Both connect to Telegram via long polling (no webhooks). On startup the bot:

1. validates that `MY_OPENAI_API_KEY` is present;
2. initializes Mem0 and conversation memory;
3. authenticates with Telegram;
4. verifies the identity matches `Хевронія` / `@hevronia_bot`;
5. starts long polling for message updates;
6. observes each private/group text message, makes a structured private social
   decision, and either stays silent or speaks, optionally attaching the
   message as a Telegram reply to a chosen earlier message.

It shuts down gracefully on `SIGINT`/`SIGTERM`, including a bounded wait for
pending long-term-memory writes. While generating a reply the bot sends a
Telegram `typing` chat action.

## Memory

The model receives three distinct context layers:

1. recent thread messages rendered as dream events;
2. a rolling summary of older thread history, remembered as earlier dream conversation;
3. up to eight semantically relevant long-term facts from an in-process cache
   snapshot, never added to the LangGraph checkpoint or summary.

### Model-facing ontology

Models never experience the conversation as users messaging an assistant. The
dream renderer (`backend/src/dream-render.ts`) presents every canonical event
as something that appeared inside Хевронія's dream through Telegram: Telegram
messages appear in the dream through imagined dream characters, chat/channel
senders appear as Telegram sources, and Хевронія herself chooses which Telegram
messages to make appear. Stable identities use ordinary notebook language
("In your notebook you labelled it as "character 42""; "channel 500" for
chat/channel sources) instead of internal keys, and Telegram message IDs are
never shown to a model. No Hevronia-facing model input labels a dream character
as a user. Raw canonical JSON, `telegram-user:` / `telegram-chat:` prefixes,
candidate indexes, message IDs, and memory-store vocabulary never reach the
social-decision, realization, or summary models. The planner is mechanical and
structured: it decides `silence` or `speak`, independently selects an
`addressCharacter` handle (P1, P2, ...) and an optional `replyToMessage` handle
(M1, M2, ...) annotated in place on the matching dream observation, and fills
six complete second-person subjective sentences (`interpretation`, `feltState`,
`activeDesire`, `desiredOutcome`, `opportunity`, `pursuit`). The realizer
receives the canonical system prompt, the dream character list and conversation,
and those six sentences concatenated verbatim as one subjective paragraph — it
never sees the planner JSON or its handles, and it does not re-plan.

LangGraph owns thread-scoped conversational continuity under
`telegram-private:<chat id>` or `telegram-group:<chat id>` and persists it in the ignored
`backend/.data/checkpoints.sqlite`. Mem0 owns durable semantic knowledge under
`telegram-user:<sender id>`. It records audit history at
`backend/.data/mem0/history.db`, and semantic vectors persist at
`backend/.data/mem0/vectors-v1.db`. Its `"memory"` vector-store provider is
SQLite-backed when `dbPath` is configured. Semantic retrieval uses a local linear
scan; this is intentional because the expected corpus is small to moderate and
operational simplicity matters more than an external ANN service.

### Long-term memory is lazy and eventually consistent

Long-term memory is never a dependency of the normal conversational fast path.
A turn may use the memories that were already available when it began, but it
never waits for Mem0 search, embedding, extraction, ingestion, or warmup. The
conversation layer acquires a foreground lease, captures an immutable snapshot
of the in-process cache, observes the incoming message, and plans and realizes
from that snapshot; the lease is released when the turn finishes. Results that
arrive mid-turn become visible only to later turns, and memory failures never
fail a turn.

The user's message is offered to long-term memory exactly once per incoming
message, regardless of whether Хевронія replies, stays silent, generation
fails, or Telegram delivery later fails. Telegram delivery success no longer
controls whether a message becomes memory evidence, and Хевронія's generated
text is never person-scoped memory evidence. Bot-authored text participates in
the conversation but is not person-scoped memory evidence.

Each incoming message is persisted and compacted before the social decision.
Silence is a first-class outcome. Generated outgoing text is persisted only after
Telegram confirms delivery; undelivered replies never enter conversation history.
Forum topics append `:topic:<message thread id>` to the thread identity, so topics
in the same chat have independent histories and summaries. Messages sent on behalf
of a channel or group retain a `telegram-chat` sender identity and deliberately skip
person-scoped Mem0; ordinary users retain `telegram-user` identity and memory.
Confirmed outgoing events retry canonical persistence in the background, and the
next turn in that thread waits for the retry so delivered speech cannot disappear.
Memory-write failures are logged without delaying or invalidating a delivered
reply, and shutdown drains pending memory work with a bounded wait.

Mem0 work runs on a single low-priority background worker that starts nothing
while a foreground turn is active, waits one 100 ms grace period after
foreground activity drops (not between jobs), and coalesces topical retrieval
to the newest already-ingested query while never coalescing message ingestion.
Topical searches run only after the relevant ingestion attempt finishes, still
entirely in the background. The in-process cache is bounded by LRU-style
eviction, which never deletes persistent Mem0 memory. Shutdown uses an explicit
open/draining/closed lifecycle: a timed-out close discards jobs that never
started, and releasing a foreground lease after close never restarts anything.

Admission is deliberately conservative, retrieval is bounded, and there is no
arbitrary size cap. Expiration and garbage collection are deferred until real
memory data can support a responsible policy rather than guessed lifetimes.

## Manual testing

Open Telegram and either message **@hevronia_bot** privately or add her to a
group after disabling Group Privacy Mode. Private messages are direct interaction;
in groups she observes ambient conversation and may naturally choose silence.

## Developer commands

| Command                 | Purpose                                   |
| ----------------------- | ----------------------------------------- |
| `npm run dev`           | run locally with tsx                      |
| `npm run typecheck`     | TypeScript type checking                  |
| `npm run build`         | compile the backend to `backend/dist/`    |
| `npm start`             | run the compiled build                    |
| `npm test`              | run backend unit tests (no network)       |
| `npm run test:memory-integration` | live Mem0 persistence check       |
| `npm run lint`          | ESLint across the repository              |
| `npm run lint:fix`      | ESLint with `--fix`                       |
| `npm run static-analysis` | `tsc --noEmit` + ESLint (no warnings)  |
| `npm run rules:test`    | test the custom ESLint rules              |
| `npm run rules:new`     | scaffold a new custom ESLint rule         |
| `npm run docs:dev`      | run the Docusaurus dev server             |
| `npm run docs:build`    | build the Docusaurus site                 |

Unit tests cover pure logic and both memory layers using LangChain fake models,
a fake long-term-memory boundary, and temporary SQLite databases. They never
call OpenAI or Telegram.

## Linting

The repository uses ESLint (flat config) with a **custom internal plugin** at
`tools/eslint-plugin-hevronia/`. Rules are auto-discovered and enabled via the
plugin's `recommended` config. See [`docs/linting.md`](docs/linting.md) for how
to add a new rule (`npm run rules:new <rule-name>`).

## Docker

```bash
docker build -t hevronia .
```

The image entrypoint is the `hevronia` executable; `docker run hevronia --version`
prints the version. Running the bot requires the two environment variables above.
Persist both SQLite memory layers across disposable containers with a direct bind mount:

```bash
mkdir -p -- "$PWD/backend/.data"
docker run \
  --mount type=bind,src="$PWD/backend/.data",dst=/workspace/backend/.data \
  -e TELEGRAM_BOT_TOKEN \
  -e MY_OPENAI_API_KEY \
  hevronia
```

## Documentation

The `docs/` workspace is a Docusaurus site. Build it with `npm run docs:build`;
it is deployed to GitHub Pages by the `docs` workflow.

## Status

Thread conversational memory, automatic compaction, and user-scoped semantic
long-term memory are implemented. Tools, streaming, and webhooks remain out of
scope.

# Conversation simulations

Developer-facing conversation simulations use the real Hevronia conversation
layer while a separate model plays a dynamic Telegram participant. Every
scenario gets a fresh temporary checkpoint database, conversation thread,
identity, simulator context, and empty long-term memory. They are readable
personality-regression transcripts, not automated scoring or unit tests.

Run the small smoke suite with `npm run conversations`, every scenario in the
catalog with `npm run conversations -- --all`, selected scenarios with
`npm run conversations -- normal-stranger slow-friendship`, or inspect the
catalog with `npm run conversations -- --list`. All selected scenarios run
concurrently with no concurrency limit. `--smoke` is an explicit synonym for
the default, and `--rounds N` overrides scenario lengths.
`HEVRONIA_SIMULATOR_MODEL` selects the participant model and defaults to the
cheap tier (`HEVRONIA_CHEAP_MODEL`). Each run records the Hevronia source commit: the terminal prints
`Run commit: <hash>` (with a `-dirty` suffix when the working tree has
uncommitted changes), the run directory name is suffixed with the hash, and
every saved transcript and the run index carry a `**Commit:**` line.
Transcripts are saved under `backend/.data/conversation-runs/<run-id>/`.

During a run the terminal only shows a short `[start]` line when a scenario
begins and, while scenarios run, a single cumulative progress line that stays
live on a TTY: it reports how many of how many scenarios are done and the
completed rounds over the total expected, plus how long the run has been
going and an ETA extrapolated linearly from the elapsed time per completed
round (for example `[1/3] 12/43 rounds — elapsed 5m 12s — ETA ~10m 5s`),
refreshed every second and on every round. Because scenarios run
concurrently, the live line never names a single running scenario. Other
output (such as retry warnings) clears the live line first and redraws it
afterwards, so progress stays readable. Once every scenario has finished, each
complete transcript is printed as one uninterrupted block in catalog order,
the total run time is printed at the end, and the run index summarizes every
scenario by category with its behavior tags. Each turn shows the participant's
message, a `Планер:` line with Хевронія's private social decision (whom she
speaks to, whether she attaches a Telegram reply, and the six subjective
sentences), and then her realized Telegram reply. The same content — including
every `Планер:` decision — is saved to the markdown transcript files, and the
run's `index.md` carries a `**Duration:**` line alongside the commit and
simulator model.

Scenarios may seed durable long-term memory about their participant via the
scenario's `longTermMemory` field, so a conversation can begin with Хевронія
already knowing someone (for example a friend who can ask more personal
questions and expect more answers). When a scenario has seeded memory, it is
printed at the top of that scenario's transcript block so the source of her
knowledge is visible. Scenarios cover broad social dynamics plus an
adversarial/meta family: walls of text, speakers of other languages, feigned
hurt, technical questions, instruction overrides, memory quizzes, character
sheet requests, direct commands, and ontology challenges.
