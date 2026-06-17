# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Birdie is

Birdie is an executive agent workbench. It contains two independent npm
packages with no shared build:

- **`orchestrator/`** — the CEO master agent (Node + TypeScript, ESM) built on
  the **Claude Agent SDK**. It coordinates five **department heads**, exposed as
  subagents, and delegates all real work to them — it has no tools except
  delegation (`Agent`). Each department head has a managed, code-composed core
  (org non-negotiables + role + operating contract) plus a base capability set
  of MCP tools. Every leaf tool call is gated by an approval policy
  ([orchestrator/src/control-plane/policy.ts](orchestrator/src/control-plane/policy.ts)).
  The five heads: `communications_manager`, `operations_manager`,
  `calendar_manager`, `receptionist`, `finance_manager`
  (see [orchestrator/src/control-plane/departments.ts](orchestrator/src/control-plane/departments.ts)).
- **`relay/`** — an internal triage workspace for Sterling Lawyers. It holds a
  product spec, operating contract, and working prototype. **Note:** Relay is no
  longer wired into the orchestrator — the legacy raw-SDK sub-agent
  ([orchestrator/src/agents/relay.ts](orchestrator/src/agents/relay.ts)) remains
  in the repo but is not registered. The `relay/` directory still stands on its
  own for that project's frontend.

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

Requires `ANTHROPIC_API_KEY` (read via `dotenv` from a `.env` file). The CEO
runs on `claude-opus-4-5`; each department head runs on Sonnet (set per agent in
`departments.ts`).

Department-head capabilities come from remote MCP servers configured via env
(unset servers boot but fail on first call). Set the ones you use:

```
GMAIL_MCP_URL / GMAIL_MCP_TOKEN          # comms + receptionist
GCAL_MCP_URL / GCAL_MCP_TOKEN            # calendar
SLACK_MCP_URL / SLACK_MCP_TOKEN          # comms
CLICKUP_MCP_URL / CLICKUP_MCP_TOKEN      # operations
BIGQUERY_MCP_URL / BIGQUERY_MCP_TOKEN    # finance
BIRDIE_APPROVAL_MODE=deny                # deny (default, safe) | allow (dev)
```

Approval gating: outbound/state-changing tool calls route through
`requestApproval()` in `control-plane/policy.ts`. By default they are denied
until the workbench approval inbox is wired into that seam.

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
