---
title: Architecture
---

# Architecture

Хевронія is a Node.js / TypeScript Telegram bot. The repository uses an npm
workspace layout: the bot lives in `backend/`, the Docusaurus documentation
lives in `docs/`, and internal tooling lives in `tools/` and `scripts/`.

## Bot flow

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

## Module layout

- `backend/src/telegram.ts` — Telegram transport only (grammY, long polling).
  Maps a chat to a thread id and calls `respond(threadId, messageText)`.
- `backend/src/respond.ts` — the conversational entry point.
- `backend/src/memory.ts` — the LangChain agent, `summarizationMiddleware`, and
  the SQLite checkpointer (`SqliteSaver`).
- `backend/src/personality.ts` — Хевронія's system prompt.

Conversation state is owned by LangGraph and persisted in the ignored
`backend/.data/checkpoints.sqlite`. It survives process restarts.

## Tooling

- `npm run static-analysis` — `tsc --noEmit` plus ESLint across the repository.
- `npm run lint` / `npm run lint:fix` — ESLint (custom plugin included).
- `npm run rules:test` — tests for the custom ESLint rules in
  `tools/eslint-plugin-hevronia/`.
- `npm run rules:new <name>` — scaffold a new custom ESLint rule.
- `npm test` — backend unit tests (Node's built-in test runner; no network).
- `npm run build` — compile the backend with `tsc`.
- `docker build .` — build the Hevronia container image.
