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
        ├── thread_id → LangGraph recent messages + rolling summary
        └── user_id   → Mem0 search → five relevant semantic memories
                                    ↓
                       dynamic system prompt (ephemeral)
                                    ↓
                         OpenAI → Хевронія response
                                    ↓
                           Telegram delivery
                                    ↓
                         Mem0 extraction and Qdrant
```

## Module layout

- `backend/src/telegram.ts` — Telegram transport only (grammY, long polling).
  Maps the chat and sender to stable thread and user identifiers.
- `backend/src/respond.ts` — the conversational entry point.
- `backend/src/layer.ts` — the LangChain agent, `summarizationMiddleware`,
  ephemeral memory-prompt middleware, and the SQLite checkpointer.
- `backend/src/long-term-memory/` — the Mem0 boundary, Qdrant service
  configuration, pending-write lifecycle, and conservative extraction policy.
- `backend/src/personality.ts` — Хевронія's system prompt.

Conversation state is owned by LangGraph and persisted in the ignored
`backend/.data/checkpoints.sqlite`. It survives process restarts.

Mem0 owns durable knowledge about a person, scoped by
`telegram-user:<sender id>`. Its SQLite history lives beneath the ignored
`backend/.data/mem0/`; the Qdrant service provided by Compose persists vectors
under `backend/.data/qdrant/`. The bundled Qdrant server and JS client are both
pinned to 1.19.0. Startup waits for Qdrant's `/readyz` response before Mem0 is
constructed; Compose ordering alone is not treated as readiness. Recalled facts exist only in the dynamic system
prompt for one invocation, so they cannot enter checkpoints or rolling
summaries. Only successfully delivered turns are offered to Mem0. Search or
ingestion failures degrade to normal thread-only behavior, and shutdown drains
pending writes with a bounded wait.
There is no automatic expiration or garbage collection: conservative admission
and top-five retrieval control the initial data set until operational evidence
supports a more precise lifecycle policy.

## Tooling

- `npm run static-analysis` — `tsc --noEmit` plus ESLint across the repository.
- `npm run lint` / `npm run lint:fix` — ESLint (custom plugin included).
- `npm run rules:test` — tests for the custom ESLint rules in
  `tools/eslint-plugin-hevronia/`.
- `npm run rules:new <name>` — scaffold a new custom ESLint rule.
- `npm test` — backend unit tests (Node's built-in test runner; no network).
- `npm run build` — compile the backend with `tsc`.
- `docker build .` — build the Hevronia container image.
