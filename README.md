# Хевронія (@hevronia_bot)

A Telegram bot for Хевронія, a fictional Ukrainian woman. The bot connects to
Telegram over **long polling** via **grammY**, and generates each reply with an
**OpenAI chat model** through **LangChain** (`@langchain/openai`).

Every private Telegram chat has its own **durable conversational thread**.
Recent messages are retained verbatim; older history is automatically compacted
into a rolling summary by LangChain summarization. This is **thread-level
conversational memory** — it is not semantic long-term memory, and there are no
user profiles, embeddings, or retrieval.

```
Telegram private chat
    ↓
stable thread_id (telegram-private:<chat id>)
    ↓
LangChain agent (backend/src/memory.ts, createAgent)
    ↓
LangGraph SQLite checkpointer  →  backend/.data/checkpoints.sqlite
    ↓
summarizationMiddleware
    ├── older history → compact rolling summary
    └── recent history → verbatim
    ↓
OpenAI → Хевронія response
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

- Node.js >= 20 (tested on Node 22)
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
  integration. `OPENAI_API_KEY` is neither expected nor used.

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

1. authenticates with Telegram;
2. verifies the identity matches `Хевронія` / `@hevronia_bot`;
3. validates that `MY_OPENAI_API_KEY` is present;
4. opens the conversation-memory database;
5. starts long polling for message updates;
6. replies to each private text message.

It shuts down gracefully on `SIGINT`/`SIGTERM`. While generating a reply the
bot sends a Telegram `typing` chat action.

## Memory

- Each private chat maps to a LangGraph thread: `telegram-private:<chat id>`.
  Different chats have fully isolated histories.
- Conversation state is stored in a local SQLite database at
  `backend/.data/checkpoints.sqlite` (git-ignored).
- The database is resolved relative to the module, so the bot works from any
  working directory.
- Memory survives process restarts.
- Once a thread's history grows past the compaction threshold, older messages
  are summarized and only the newest tokens stay verbatim. The thresholds live
  in `backend/src/memory.ts` (`COMPACTION`).

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
| `npm run lint`          | ESLint across the repository              |
| `npm run lint:fix`      | ESLint with `--fix`                       |
| `npm run static-analysis` | `tsc --noEmit` + ESLint (no warnings)  |
| `npm run rules:test`    | test the custom ESLint rules              |
| `npm run rules:new`     | scaffold a new custom ESLint rule         |
| `npm run docs:dev`      | run the Docusaurus dev server             |
| `npm run docs:build`    | build the Docusaurus site                 |

Unit tests cover pure logic (API-key validation, response-text extraction) and
conversation-memory behavior using LangChain fake models and a temporary SQLite
database. They never call OpenAI or Telegram.

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

Thread-level conversational memory with automatic compaction is implemented.
Still out of scope: semantic long-term memory, user profiles, embeddings,
retrieval, tools, streaming, and webhooks.
