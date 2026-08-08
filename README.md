# Хевронія (@hevronia_bot)

A Telegram bot for Хевронія, a fictional Ukrainian woman. The bot connects to
Telegram over **long polling** via **grammY**, and generates each reply with an
**OpenAI chat model** through **LangChain** (`@langchain/openai`).

The conversation engine is currently **stateless**: every private text message
is handled independently and the reply is generated from a single
Хевронія system prompt plus the message. There is no memory or conversation
history yet.

```
Telegram update
    ↓
Telegram transport  (src/telegram.ts, grammY, long polling)
    ↓
respond(text)       (src/respond.ts, LangChain ChatOpenAI)
    ↓
Хевронія system prompt  (src/personality.ts)
    ↓
OpenAI → text reply
    ↓
Telegram transport
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
npm run dev        # development (tsx, no build step)
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
4. starts long polling for message updates;
5. replies to each private text message.

It shuts down gracefully on `SIGINT`/`SIGTERM`. While generating a reply the
bot sends a Telegram `typing` chat action.

## Manual testing

Open Telegram, find **@hevronia_bot**, and send any text message in a private
chat. Хевронія will answer in character.

## Developer commands

| Command                 | Purpose                         |
| ----------------------- | ------------------------------- |
| `npm run dev`           | run locally with tsx            |
| `npm run typecheck`     | TypeScript type checking        |
| `npm run build`         | compile to `dist/`              |
| `npm start`             | run the compiled build          |
| `npm test`              | run unit tests (no network)     |

Unit tests cover pure logic only (API-key validation, prompt construction,
response-text extraction) and never call OpenAI or Telegram.

## Project layout

```text
src/
├── index.ts       entry point
├── telegram.ts    Telegram transport (grammY, long polling)
├── respond.ts     LangChain ChatOpenAI response generation
└── personality.ts Хевронія's system prompt
test/
└── respond.test.ts
```

## Status

Conversation history is **not yet implemented** — each message is currently
interpreted independently. No memory, persistence, embeddings, retrieval,
agents, tools, streaming, or webhooks yet.
