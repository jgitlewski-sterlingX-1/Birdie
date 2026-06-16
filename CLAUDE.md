# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Birdie is

Birdie is a multi-project software workbench. It contains two independent npm
packages with no shared build:

- **`orchestrator/`** — a master agent (Node + TypeScript, ESM) that routes a
  user task to the right project sub-agent. Sub-agents are exposed to the
  orchestrator as Anthropic tool calls; the orchestrator runs an agentic loop,
  delegates, and synthesizes the final answer. It never writes project code
  itself — it always delegates.
- **`relay/`** — the first (and currently only) project the orchestrator
  manages. Relay is an internal triage workspace for Sterling Lawyers. This
  directory holds the product spec, the operating contract, and a working
  prototype.

The two are linked at runtime: the Relay sub-agent
([orchestrator/src/agents/relay.ts](orchestrator/src/agents/relay.ts)) reads
`relay/CLAUDE.md` and `relay/BUILD_SPEC.md` off disk (`../../../relay`, relative
to the compiled file) and injects them into its system prompt. **If you move
either directory or rename those docs, update that path** or the sub-agent loses
its context.

## Working on Relay

**Before doing any Relay work, read [relay/CLAUDE.md](relay/CLAUDE.md)** — it is
the authoritative operating contract (non-negotiables, stack, how to build), and
[relay/BUILD_SPEC.md](relay/BUILD_SPEC.md) is the authoritative product spec.
Decisions made when those docs conflict are logged in
[relay/DECISIONS.md](relay/DECISIONS.md). Do not duplicate that guidance here.

The one architectural fact worth surfacing at the repo level: `relay/kanban/` is
a **prototype, not throwaway code**. It is a Vite + React 19 + TypeScript SPA
with all state in `localStorage`, and it is the source of truth for UX and the
domain model ([relay/kanban/src/types.ts](relay/kanban/src/types.ts)). The
production plan is to keep the React UI unchanged and reimplement persistence
behind five hooks so they call a real API with byte-identical return shapes:

- `useBoard` → [src/store.ts](relay/kanban/src/store.ts)
- `useProjects` → [src/projectsStore.ts](relay/kanban/src/projectsStore.ts)
- `useSkills` → [src/skillsStore.ts](relay/kanban/src/skillsStore.ts)
- `useApprovals` → [src/approvalsStore.ts](relay/kanban/src/approvalsStore.ts)
- `useSession` → [src/session.tsx](relay/kanban/src/session.tsx)

## Commands

Each package is built and run independently from its own directory. There is no
root-level package or workspace.

### orchestrator/

Requires `ANTHROPIC_API_KEY` (read via `dotenv` from a `.env` file). Model ids
are hardcoded in the source — `claude-opus-4-5` for the orchestrator loop, and
the Relay sub-agent calls a Claude Sonnet model.

```bash
npm install
npm run dev                       # interactive REPL
npm run dev -- --task "..."       # one-shot task
npm run build                     # tsc → dist/
npm start                         # node dist/index.js (after build)
```

### relay/kanban/

The prototype frontend talks to a small Express server
([server/index.mjs](relay/kanban/server/index.mjs)) that scaffolds Gmail OAuth.
Copy `.env.example` and set `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` before
testing the Gmail connect flow (see [relay/kanban/README.md](relay/kanban/README.md)).

```bash
npm install
npm run dev:full     # frontend (Vite :5173) + API server (Express :8787) together
npm run dev          # frontend only, :5173
npm run server:dev   # API server only, :8787
npm run build        # tsc -b && vite build
npm run lint         # eslint .
npm run preview      # serve the production build
```

There are no test scripts configured in either package yet. The Relay contract
([relay/CLAUDE.md](relay/CLAUDE.md) §11) requires every new production endpoint
to ship with tests (including a per-user-isolation test) once the real backend
exists.
