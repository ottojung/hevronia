# Хевронія (@hevronia_bot)

A Telegram bot for Хевронія, a fictional Ukrainian woman. The bot connects to
Telegram over **long polling** via **grammY**, and generates each reply with an
**OpenAI chat model** through **LangChain** (`@langchain/openai`).

Every private Telegram chat has a durable LangGraph conversational thread.
Recent messages remain verbatim and older history becomes a rolling summary.
Separately, Mem0 extracts durable facts from successful turns and semantically
recalls a small relevant set for the Telegram user in future conversations.

```
Telegram private chat
    ├── thread_id → LangGraph recent messages + rolling summary
    └── user_id   → Mem0 semantic search (top 5, Qdrant service)
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
- Qdrant 1.19.0 (the provided Compose service is the simplest local option)

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
- `QDRANT_URL` selects the Qdrant HTTP endpoint and defaults to
  `http://127.0.0.1:6333`.

The bot fails fast at startup if either variable is absent. Secrets are never
printed, logged, or stored, and should never be committed.

In the normal working environment both variables are already provided through
`$MIYKA_PROJ_PATH/env`. If they are not loaded into your shell yet:

```bash
. "$MIYKA_PROJ_PATH/env"
```

## Running locally

```bash
docker compose up -d qdrant
npm run dev        # development (tsx watch, no build step)
```

The bot may start immediately after Compose. It polls Qdrant's `/readyz`
endpoint before constructing Mem0, for up to 60 seconds.

or, for the compiled build:

```bash
npm run build
npm start
```

Both connect to Telegram via long polling (no webhooks). On startup the bot:

1. validates that `MY_OPENAI_API_KEY` is present;
2. waits for Qdrant readiness, then initializes Mem0 and conversation memory;
3. authenticates with Telegram;
4. verifies the identity matches `Хевронія` / `@hevronia_bot`;
5. starts long polling for message updates;
6. replies to each private text message.

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
`telegram-private:<chat id>` and persists it in the ignored
`backend/.data/checkpoints.sqlite`. Mem0 owns durable semantic knowledge under
`telegram-user:<sender id>`. It extracts concise facts only from completed
user/assistant turns and records audit history at
`backend/.data/mem0/history.db`. A real Qdrant service stores the versioned
vector collection. The provided Compose service persists Qdrant data at
`backend/.data/qdrant/`; `QDRANT_URL` may instead select another deployment.

Each turn retrieves memories, generates a reply, sends it through Telegram,
and only then starts Mem0 extraction. Undelivered replies are not memorized.
Memory-write failures are logged without delaying or invalidating a delivered
reply, and pending writes receive a bounded drain during shutdown.

Admission is deliberately conservative, retrieval is bounded, and there is no
arbitrary size cap. Expiration and garbage collection are deferred until real
memory data can support a responsible policy rather than guessed lifetimes.

## Manual testing

Open Telegram, find **@hevronia_bot**, and send any text message in a private
chat. Хевронія will answer in character and will remember earlier turns of the
same chat.

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
call OpenAI, Qdrant, or Telegram.

## Linting

The repository uses ESLint (flat config) with a **custom internal plugin** at
`tools/eslint-plugin-hevronia/`. Rules are auto-discovered and enabled via the
plugin's `recommended` config. See [`docs/linting.md`](docs/linting.md) for how
to add a new rule (`npm run rules:new <rule-name>`).

## Docker

```bash
docker build .
```

The image entrypoint is the `hevronia` executable; `docker run <image> --version`
prints the version. Running the bot requires the two environment variables above.

## Documentation

The `docs/` workspace is a Docusaurus site. Build it with `npm run docs:build`;
it is deployed to GitHub Pages by the `docs` workflow.

## Status

Thread conversational memory, automatic compaction, and user-scoped semantic
long-term memory are implemented. Tools, streaming, and webhooks remain out of
scope.
