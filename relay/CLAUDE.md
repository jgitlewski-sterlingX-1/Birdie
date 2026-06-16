# Relay — Build Instructions (CLAUDE.md)

This is the operating contract for the agent building **Relay**. Read it fully
before writing code. It does not replace `BUILD_SPEC.md` — that document is the
authoritative product spec (domain model §3, API §8, phases §9, etc.), and the
`kanban/` prototype is the authoritative source of truth for UX and behavior.

This file tells you **how to build**, what the hard rules are, and where to look.

When this file, BUILD_SPEC.md, and the prototype agree, follow them. When they
conflict, surface it and ask — do not silently guess. Log every such decision in
`DECISIONS.md`.

## 1. What Relay is

An internal **triage workspace** for Sterling Lawyers (~100 users), served at
`relay.sterlingx.com`, hosted entirely in the `sterlingx.com` GCP org. Work from
Gmail, Slack, and Salesforce is AI-classified into **cards** on a kanban board.
Each card carries its source context plus an AI summary and subtasks. Users act
on cards (reply / draft / complete) and **every outbound action requires explicit
human approval and is written to an immutable audit log.**

Defining principle, above all features: **AI proposes, the human approves.**
**Nothing leaves the tool without an approval, and every approval is recorded.**

## 2. The single most important architectural fact: the migration seam

A working prototype exists (`kanban/`, Vite + React + TS, all state in
`localStorage`). **Do not rebuild the UI.** All persistence is isolated behind
five hooks:

- `useBoard` → `src/store.ts`
- `useProjects` → `src/projectsStore.ts`
- `useSkills` → `src/skillsStore.ts`
- `useApprovals` → `src/approvalsStore.ts`
- `useSession` → `src/session.tsx`

Your job is to **reimplement these hooks to call the API with byte-identical
return shapes**, so the existing React UI works unchanged. Before touching any
hook, open its prototype implementation and the components that consume it, and
run the prototype (`cd kanban && npm install && npm run dev`) to observe the
behavior you must preserve. The full file map is BUILD_SPEC.md §14.

## 3. Non-negotiables (any violation is a blocking defect)

1. **Per-user isolation.** Every user-owned row carries `userId`; every query is
   scoped to the session user. Enforce in the app layer **and** with Postgres
   row-level security, enabled from the first migration — not deferred to Phase 5.

2. **Approval-gated outbound actions, atomically logged.** No Gmail draft, Slack
   reply, or Salesforce completion executes without explicit approval. Each action
   endpoint performs the external call and writes the `ApprovalLogEntry` such that
   it can never record an approval for a failed action, nor perform an action
   without recording it (with the real `externalRef`). On failure: surface the
   error, do **not** mark approved.

3. **The approval log is append-only and immutable.** No UPDATE, no DELETE, no
   "clear log" endpoint, ever — enforce at the DB level (grants/RLS), not just by
   omitting routes. It is the firm's compliance record.

4. **Drafts only — never send.** Gmail scopes are `gmail.readonly` + `gmail.compose`.
   Any path that could send email is a blocking defect.

5. **Secrets stay server-side.** OAuth tokens encrypted at rest with Cloud KMS
   (envelope encryption); client secrets + model creds in Secret Manager; nothing
   sensitive in the client bundle, `NEXT_PUBLIC_*`, logs, or fixtures. Cloud Run
   runs as a least-privilege service account.

6. **Law-firm confidentiality.** Content may be privileged. Minimize what is
   stored (prefer re-fetching bodies over warehousing); keep all data in the
   `sterlingx.com` GCP org; never put email/Salesforce content in logs, Error
   Reporting, traces, analytics events, or test fixtures.

7. **Hook contract.** The five store hooks keep their prototype return shapes.

## 4. Stack (per BUILD_SPEC.md §2 — do not substitute without asking)

Next.js (App Router, TS) in a container on **Cloud Run** · **Cloud SQL for
PostgreSQL** (private IP / Cloud SQL connector) · app login via **Google
Workspace SSO behind IAP**, access controlled by an Admin-console **Google
Group**; the **API also verifies Google ID tokens** as bearer tokens so a future
mobile client is cheap (API-first, §2.1) · **Claude via Vertex AI** (keeps
inference in GCP — the confidentiality-safe default) · background sync via
**Cloud Scheduler → Cloud Run Jobs** · **Cloud Build → Artifact Registry →
Cloud Run** for CI/CD · `relay.sterlingx.com` via domain mapping / HTTPS LB.

Build **API-first**: the backend is a clean JSON API; the web SPA is one client.

## 5. Domain model & API

Implement the schema exactly as BUILD_SPEC.md §3 specifies. Critical points the
agent must not get wrong:

- **Normalization:** the prototype stores the board as `{columns[], cards{}}` with
  `cardIds[]`. In Postgres, cards carry `columnId` + `position`; **subtasks carry
  `parentId` + `position` with `columnId` null.**

- **A subtask is a full card** (`parentId` set) with every capability recursively
  — not a lightweight checklist item.

- **Ingested cards** dedupe on (`provider`, `externalId`) (e.g. Gmail `threadId`).

- **Skills:** base skills are global (`userId` null), read-only, inherited by all;
  custom skills belong to a user and augment the base skill's prompt for a
  category. API exposes custom CRUD only; base is read-only.

- **ApprovalLogEntry** and **IntegrationConnection** as in §3; tokens encrypted.

API surface is BUILD_SPEC.md §8 — all endpoints authenticated, all data scoped to
the session user. The action endpoints (`gmail-draft`, `slack-reply`,
`salesforce-complete`) are where rule 2's atomic pattern lives.

## 6. Integrations: direct REST, no MCP (BUILD_SPEC.md §6)

Call each vendor's REST API directly, server-to-server, with per-user OAuth.
**Do not stand up an MCP server** — Relay's sync + approval-gated actions are
deterministic and don't need model-driven tool access. Per-user OAuth everywhere
(including Salesforce — Authorization Code flow, never the JWT single-user
pattern); Relay acts **as the user** so the vendor's own permission model governs
visibility. Request least-privilege scopes. Sync is idempotent and replay-safe.

## 7. AI / skills (BUILD_SPEC.md §5) — and cost is a design requirement

Classification, thread summary, and subtask extraction run **server-side at
ingestion time** via Claude on Vertex AI, never on client load. Output is
validated against the card schema before it touches the DB; `todosExtracted`
makes extraction idempotent and user deletions stay deleted.

These cost levers are **architecture, not later tuning** (BUILD_SPEC.md §13):

1. **Pre-filter before Claude** — cheap rules / a tiny model drop NOISE; run the
   full skill only on ACTION_NEEDED items. This is the biggest lever.

2. **Tier models** — Haiku-class for bulk classification, a stronger model only
   for summaries/drafts. Model ids are config, not code.

3. **Cache & dedupe** per thread; **batch** ingestion; emit per-call token/cost
   metrics so budget alerts have data.

Keep the model call behind a single `SkillEngine` interface so a future
Agent-Engine-backed implementation is a drop-in swap.

## 8. Cross-cutting from Phase 1 (not deferred)

- **Observability (§11):** `/healthz` + a deep readiness check (DB + each
  integration's last-sync status) from the start; structured logs to Cloud
  Logging; instrument as you build. Alert design targets the likely outages:
  per-user OAuth token-refresh failures, sync-job failures, outbound-action
  failures.

- **Usage analytics (§12):** emit `{event, userId, ts, properties}` events
  (`app_opened`, `card_triaged`, `reply_drafted`, `reply_approved`, …) →
  Pub/Sub → BigQuery. **Actions and counts only — never subjects or bodies.**

## 9. Phased delivery (BUILD_SPEC.md §9 — each phase's "Done when" is the gate)

1. **Backend foundation** — schema (§3), API (§8), Google sign-in (domain-locked),
   repoint the five hooks, seed base skills + default columns per new user.

2. **Gmail** — internal OAuth app, encrypted tokens, sync worker, real draft
   creation on approval.

3. **Real skills** — server-side Claude classification/summary/subtasks at
   ingestion; custom skills feed the prompt.

4. **Slack + Salesforce** — sync + approval-gated actions mirroring Gmail.

5. **Harden & deploy** — RLS enforced, append-only log enforced, retention policy,
   full deploy pipeline, observability + analytics live.

Do not declare a phase done until its "Done when" statement is provably met,
including negative tests (cross-user access fails; approval-log mutation rejected
at the DB; a failed external call writes no approval row).

## 10. Human-only — do not attempt; flag if blocked (BUILD_SPEC.md §10)

The §10 open questions are decisions, not code. The critical-path one is the
**Workspace-domain question** (`sterlinglawyers.com` vs `sterlingx.com`), which
gates Phase 2's Gmail OAuth app — resolve it before Phase 2. Also human-only:
OAuth consent-screen setup + Admin-console allowlisting, the access Google Group,
the Salesforce Connected App + policies, IAM grants, and DNS for
`relay.sterlingx.com`. Anything implicating professional-responsibility/compliance
escalates to the human.

## 11. How to work

Small, reviewable commits; one phase-area per branch; open a PR per unit of work.
Prefer surgical edits over rewrites. Never weaken a non-negotiable to make a test
pass — raise it. Every new endpoint ships with at least one test (including a
per-user-isolation test) and emits its §12 usage event.
