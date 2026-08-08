---
title: Architecture
---

# Architecture

Хевронія is a Node.js / TypeScript Telegram bot. The repository uses an npm
workspace layout: the bot lives in `backend/`, the Docusaurus documentation
lives in `docs/`, and internal tooling lives in `tools/` and `scripts/`.

## Bot flow

```
Telegram private/group chat
        ├── thread_id → LangGraph recent messages + rolling summary
        └── user_id   → Mem0 search → five relevant semantic memories
                                    ↓
                 bounded canonical event history + summary
                                    ↓
                    social decision → silence or realization
                                    ↓
                           Telegram delivery
                                    ↓
                         Mem0 extraction and Qdrant
```

## Module layout

- `backend/src/telegram.ts` — Telegram transport only (grammY, long polling).
  Maps the chat and sender to stable thread and user identifiers.
- `backend/src/respond.ts` — the conversational entry point.
- `backend/src/layer.ts` — canonical event ingestion, bounded conversation
  context, social planning, ephemeral realization, and delivery completion.
- `backend/src/long-term-memory/` — the Mem0 boundary, Qdrant service
  configuration, pending-write lifecycle, and conservative extraction policy.
- `backend/src/personality.ts` — Хевронія's system prompt.

Conversation state is owned by LangGraph and persisted in the ignored
`backend/.data/checkpoints.sqlite`. It survives process restarts.
Incoming participant events always enter this state and use the same compaction
path, including silent turns. Outgoing Хевронія events enter it only after
Telegram confirms delivery. Stable Telegram sender IDs distinguish participants
even when display names collide.

Mem0 owns durable knowledge about a person, scoped by
`telegram-user:<sender id>`. Its SQLite history lives beneath the ignored
`backend/.data/mem0/`; the Qdrant service provided by Compose persists vectors
under `backend/.data/qdrant/`. The bundled Qdrant server and JS client are both
pinned to 1.19.0. Startup waits for Qdrant's `/readyz` response before Mem0 is
constructed; Compose ordering alone is not treated as readiness. Compose mounts
the same `backend/.data/` directory into the bot container so checkpoints and
Mem0 history survive container replacement. Recalled facts exist only in the dynamic system
prompt for one invocation, so they cannot enter checkpoints or rolling
summaries. After successful delivery, only the user's message is offered to
Mem0; generated assistant text is never long-term-memory evidence. Search or
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
