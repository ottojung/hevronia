# Хевронія (@hevronia_bot)

A minimal Telegram bot skeleton. Хевронія currently connects to Telegram over
**long polling** and replies to every private text message with a trivial,
deterministic Ukrainian response:

```
Ти сказала: <message>
```

The conversational engine is deliberately a placeholder. The point of this
milestone is a clean, replaceable message-handling boundary:

```
Telegram update
    ↓
Telegram transport  (src/telegram.ts)
    ↓
message handler     (src/respond.ts)   ← the part to replace later
    ↓
response text
    ↓
Telegram transport
```

Later the trivial handler can be swapped for a real character/conversation
engine (for example `const response = await conversation.respond(message)`)
without touching the Telegram integration.

## Prerequisites

- Node.js >= 20 (tested on Node 22)
- npm

## Installation

```bash
npm install
```

## Configuration

The bot reads its token **only** from the environment variable:

```text
TELEGRAM_BOT_TOKEN
```

The bot fails fast at startup if it is absent. It is never printed, logged, or
stored.

In the normal working environment this variable is already provided through
`$MIYKA_PROJ_PATH/env`. If it is not loaded into your shell yet:

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
3. starts long polling for message updates;
4. replies to each private text message.

It shuts down gracefully on `SIGINT`/`SIGTERM`.

## Manual testing

Open Telegram, find **@hevronia_bot**, and send any text message in a private
chat. The bot should reply with `Ти сказала: <message>`.

## Developer commands

| Command                 | Purpose                         |
| ----------------------- | ------------------------------- |
| `npm run dev`           | run locally with tsx            |
| `npm run typecheck`     | TypeScript type checking        |
| `npm run build`         | compile to `dist/`              |
| `npm start`             | run the compiled build          |
| `npm test`              | run unit tests (no network)     |

Tests cover the pure response function only and never require
`TELEGRAM_BOT_TOKEN` or real Telegram access.

## Project layout

```text
src/
├── index.ts       entry point
├── telegram.ts    Telegram transport (grammY, long polling)
└── respond.ts     pure, replaceable response function
test/
└── respond.test.ts
```

## Status

The current response function is only a placeholder for the future
Хевронія character/conversation engine. No LLM, history, persistence, or
webhooks yet.
