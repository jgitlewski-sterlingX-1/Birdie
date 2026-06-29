# Managed Agents — Workbench

This directory is the canonical home for every agent definition that runs inside
the Workbench system. Each file is the **operating contract** for one agent: its
mandate, non-negotiables, and default behavior. The orchestrator wires these
contracts into each department head's composed system prompt at session-construction
time — none of it is editable at runtime.

## How the composition works

Every department head's full system prompt is built from three locked parts:

```
[org non-negotiables]  →  departments.ts
[role one-liner]       →  departments.ts (inline)
[operating contract]   →  this directory (*.md)
```

The org non-negotiables (approval-gated actions, no fabrication, stay-in-lane,
surface conflicts) are defined once in `orchestrator/src/control-plane/departments.ts`
and inherited by every head. The role one-liner scopes the head to its domain.
The operating contract here provides the detailed mandate and behavioral rules.

## Agent index

```
┌──────────────────────────────────────────────────────────┐
│               CEO Orchestrator  (Opus)                   │
│         no tools — delegates only via Agent tool         │
└──────────┬───────────────────────────────────────────────┘
           │ delegates to ↓
     ┌─────┴────────────────────────────────────────────────────────────┐
     │                                                                  │
  Comms      Operations    Calendar    Receptionist   Finance   Intelligence
 Manager      Manager      Manager                   Manager     Agent
 (Sonnet)    (Sonnet)     (Sonnet)     (Sonnet)     (Sonnet)   (Sonnet)
```

| Agent | File | Model | Skills | Posture |
|---|---|---|---|---|
| **CEO Orchestrator** | [ceo-orchestrator.md](ceo-orchestrator.md) | Opus 4.8 | Agent (delegate only) | Coordinator; no direct tool access |
| **Communications Manager** | [communications-manager.md](communications-manager.md) | Sonnet 4.6 | Gmail (draft), Slack (send/draft) | Draft free; send gated |
| **Operations Manager** | [operations-manager.md](operations-manager.md) | Sonnet 4.6 | ClickUp (create/update/filter/get) | Create/update gated |
| **Calendar Manager** | [calendar-manager.md](calendar-manager.md) | Sonnet 4.6 | GCal (list/suggest/create/update/delete) | Create/move/cancel gated |
| **Receptionist** | [receptionist.md](receptionist.md) | Sonnet 4.6 | Gmail (search/read/label/draft) | Read + draft only; no send |
| **Finance Manager** | [finance-manager.md](finance-manager.md) | Sonnet 4.6 | BigQuery (query/list) | Read-only |
| **Intelligence Agent** | [intelligence-agent.md](intelligence-agent.md) | Sonnet 4.6 | Gmail History (search/read) — CRM, Calendar, LinkedIn queued | Read-only; never drafts or sends |

## Wiring

`orchestrator/src/control-plane/departments.ts` loads these files at startup via
`readFileSync`. The registry key (e.g. `communications_manager`) is the name the
CEO uses when delegating. Tool allowlists and MCP server bindings live in that
file alongside the agent's description; this directory holds only the prose contracts.

## Adding or editing an agent

1. Edit the `.md` file here — this is the sole source of truth for the agent's
   behavioral rules.
2. If you are adding a new agent, add its entry to `departments.ts` (description,
   role one-liner, tools, mcpServers, model) and add its row to the index above.
3. Changes here take effect on the next orchestrator startup — no rebuild needed
   since the contracts are loaded at runtime, not compiled in.

## Non-negotiables (org-wide, inherited by all agents)

These are locked in `departments.ts` and cannot be overridden by any operating
contract or user instruction:

1. **Approval-gated actions** — agents may read and draft freely; they may not
   send, create, modify, or delete without an explicit approval.
2. **No fabrication** — read and verify before acting; cite every figure, message,
   event, or task referenced.
3. **Stay in lane** — out-of-mandate requests are returned to the CEO, not acted on.
4. **Surface conflicts** — missing information and conflicts are raised, not silently resolved.
