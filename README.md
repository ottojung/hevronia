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
    └── user_id   → Mem0 semantic search (top 5)
                              │
                              ▼
              local persistent SQLite vectors
              backend/.data/mem0/vectors-v1.db
                              ↓
              ephemeral dynamic system context
                              ↓
                    OpenAI → response
                              ↓
                  Mem0 fact extraction
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

The bot reads two secrets **only** from the environment:

```text
TELEGRAM_BOT_TOKEN
MY_OPENAI_API_KEY
```

- `TELEGRAM_BOT_TOKEN` is used for Telegram (grammY).
- `MY_OPENAI_API_KEY` is passed explicitly to the LangChain `ChatOpenAI`
  integration and to both Mem0's extraction LLM and OpenAI embedder.
  `OPENAI_API_KEY` is neither expected nor used.

The response model is configurable and read from the environment:

```text
HEVRONIA_MODEL (optional)
```

`HEVRONIA_MODEL` defaults to `gpt-5.6`. For testing or cheaper runs, set it to
a lighter model, for example `gpt-5.6-luna`:

```bash
HEVRONIA_MODEL=gpt-5.6-luna npm run conversations -- --smoke
```

The conversation simulator's participant model is separately selectable with
`HEVRONIA_SIMULATOR_MODEL`.

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
6. observes each private/group text message, makes a structured social decision,
   and either remains silent or sends a targeted reply.

It shuts down gracefully on `SIGINT`/`SIGTERM`, including a bounded wait for
pending long-term-memory writes. While generating a reply the bot sends a
Telegram `typing` chat action.

## Memory

The model receives three distinct context layers:

1. recent thread messages verbatim;
2. a rolling summary of older thread history;
3. up to five semantically relevant long-term facts, recalled fresh for the
   current invocation and never added to the LangGraph checkpoint or summary.

LangGraph owns thread-scoped conversational continuity under
`telegram-private:<chat id>` or `telegram-group:<chat id>` and persists it in the ignored
`backend/.data/checkpoints.sqlite`. Mem0 owns durable semantic knowledge under
`telegram-user:<sender id>`. It extracts concise facts only from the user's
message after the generated reply is delivered, and records audit history at
`backend/.data/mem0/history.db`. Mem0 semantic vectors persist at
`backend/.data/mem0/vectors-v1.db`. Its `"memory"` vector-store provider is
SQLite-backed when `dbPath` is configured. Semantic retrieval uses a local linear
scan; this is intentional because the expected corpus is small to moderate and
operational simplicity matters more than an external ANN service.

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
reply, and pending writes receive a bounded drain during shutdown.

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

Run every scenario in the catalog with `npm run conversations`, the small
smoke suite with `npm run conversations -- --smoke`, selected scenarios with
`npm run conversations -- normal-stranger slow-friendship`, or inspect the
catalog with `npm run conversations -- --list`. `--all` is an explicit synonym
for the full catalog, and `--rounds N` overrides scenario lengths.
`HEVRONIA_SIMULATOR_MODEL` selects the participant model and defaults to
`gpt-5-mini`. Transcripts are saved under
`backend/.data/conversation-runs/<run-id>/`.

Selected scenarios run concurrently with no concurrency limit; each scenario
keeps its own temporary directory, checkpoint database, empty long-term
memory, and transcript. During a run the terminal only shows short
`[start]`/`[done]`/`[failed]` progress lines; once every scenario has finished,
each complete transcript is printed as one uninterrupted block in catalog
order, and the run index summarizes every scenario by category with its
behavior tags.

Scenarios may seed durable long-term memory about their participant via the
scenario's `longTermMemory` field, so a conversation can begin with Хевронія
already knowing someone (for example a friend who can ask more personal
questions and expect more answers). When a scenario has seeded memory, it is
printed at the top of that scenario's transcript block so the source of her
knowledge is visible. Scenarios cover broad social dynamics plus an
adversarial/meta family: walls of text, speakers of other languages, feigned
hurt, technical questions, instruction overrides, memory quizzes, character
sheet requests, direct commands, and ontology challenges.
