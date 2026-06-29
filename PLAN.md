# PLAN.md — Workbench (Birdie)

**Code Owner:** Jay Gitlewski (jgitlewski@sterlinglawyers.com / jgitlewski@rocketclicks.com)
**Client:** Sterling Lawyers (primary) · Rocket Clicks (infrastructure/GCP)
**Repo:** jgitlewski-sterlingX-1/Birdie → projects/Workbench (gitlink)

## Current State

Two sub-projects:

**Relay** (`relay/kanban/`) — AI-powered inbox triage workspace for Sterling Lawyers (~100 users).
Live on Cloud Run (`https://relay-api-192448251506.us-central1.run.app`). Vite + React 19 + Express + MySQL. Phase 1 backend in progress:
- ✅ Schema: users, sessions, gmail_accounts, integration_connections, salesforce_accounts
- ✅ Google SSO + per-domain login
- ✅ Gmail OAuth (connect/disconnect, multi-account)
- ✅ Slack OAuth (connect/disconnect)
- ✅ Salesforce OAuth (connect/disconnect)
- ✅ Per-user Claude API key (Integrations tab)
- ✅ Anthropic Custom Skills CRUD (Settings → Skills tab via /v1/skills beta API)
- ✅ Admin panel: feature flags, roles, user management
- 🚧 Skill profiles & per-user skill assignment (in progress)
- 📋 Gmail real sync (Phase 2)
- 📋 Server-side Claude classification at ingestion (Phase 3)
- 📋 Slack actions + Salesforce task completion (Phase 4)
- 📋 Hardening + full deploy pipeline (Phase 5)

**Orchestrator** (`orchestrator/`) — CEO multi-agent (Opus) delegating to 5 Sonnet department heads
via Claude Agent SDK. Architectural scaffold; MCP servers not yet wired to real endpoints.

## Decisions

- Stack: Vite + React 19 + Express + MySQL (keep through Phase 1–2; evaluate migration to Next.js +
  Supabase at Phase 3 breakpoint)
- Auth: Google Workspace SSO (IAP in prod; session tokens locally). Per-user OAuth per integration.
- Skills: base skills (skills.ts, global) + Anthropic Custom Skills (per-user, Anthropic API) +
  skill profiles (named base-skill bundles, assigned per user by admin) + per-user overrides
- Orchestrator model IDs: update claude-opus-4-5 → claude-opus-4-8, claude-sonnet → claude-sonnet-4-6
  before production Orchestrator use

## Phases

### Phase 1 — Backend Foundation (🚧 in progress)

- [x] DB schema: users, sessions, gmail_accounts, integration_connections, salesforce_accounts
- [x] Google SSO + domain-locked login
- [x] Gmail OAuth connect/disconnect (multi-account)
- [x] Slack OAuth connect/disconnect
- [x] Salesforce OAuth connect/disconnect
- [x] Per-user Claude API key integration
- [x] Anthropic Custom Skills CRUD (list/create/delete via /v1/skills beta)
- [ ] **Skill profiles + per-user skill assignment** ← current work
  - [ ] DB: skill_profiles, skill_profile_items, user_skill_profiles, user_skill_overrides tables
  - [ ] API: admin CRUD for skill profiles + user assignment endpoints
  - [ ] API: user skill status (GET /api/skills/me) + toggle overrides (PUT /api/skills/me/overrides/:id)
  - [ ] UI: Settings → Skills tab → "My Skill Profile" section with toggles
  - [ ] UI: Admin panel → Skill Profiles section (create/edit/assign to users)
- [ ] **Email address groupings** ← current work
  - [ ] `EmailGroup` + `EmailAddressClassification` types in `types.ts`
  - [ ] `emailGroupsStore.ts` — localStorage CRUD for groups + per-address classification
  - [ ] CardModal Participants section — list all addresses in thread, show/assign group, inline group creator
  - [ ] Wire store through `App.tsx` → `HomePage` → `CardModal`
- [ ] Board state API (cards, columns) + repoint useBoard hook
- [ ] Projects API + repoint useProjects hook
- [ ] Approvals API (append-only) + repoint useApprovals hook

### Phase 2 — Gmail Real Sync (📋 planned)

- [ ] Background ingest worker (Cloud Scheduler → Cloud Run Job)
- [ ] Real Gmail thread sync (OAuth tokens → DB, dedup on threadId)
- [ ] Real draft creation on approval (atomic: external call + approval log entry)

### Phase 3 — Real Skills (📋 planned)

- [ ] Server-side Claude classification at ingestion (SkillEngine interface)
- [ ] Custom skills feed the classification prompt
- [ ] Haiku-class bulk pre-filter before full Sonnet classification

### Phase 4 — Slack + Salesforce (📋 planned)

- [ ] Slack message sync + approval-gated reply
- [ ] Salesforce task sync + approval-gated completion

### Phase 5 — Hardening + Deploy (📋 planned)

- [ ] RLS enforced at DB level
- [ ] Approval log immutability enforced at DB level
- [ ] Full Cloud Run deploy pipeline (Cloud Build → Artifact Registry)
- [ ] Observability: /healthz, structured logs, Cloud Logging
- [ ] Usage analytics → Pub/Sub → BigQuery

## Relevant Files

- `relay/CLAUDE.md` — Relay operating contract (non-negotiables, stack)
- `relay/BUILD_SPEC.md` — authoritative product spec (domain model, API, phases)
- `relay/DECISIONS.md` — decision log
- `relay/kanban/src/types.ts` — domain model
- `relay/kanban/src/skills.ts` — base skill definitions
- `relay/kanban/server/init-db.mjs` — DB schema (idempotent CREATE TABLE IF NOT EXISTS)
- `relay/kanban/server/index.mjs` — Express API server
- `relay/kanban/src/pages/SettingsPage.tsx` — Settings UI
- `relay/kanban/src/components/AdminPanel.tsx` — Admin UI

## Verification

```bash
# from relay/kanban/
npm run dev:full          # frontend :5173 + API :8787
npm run lint              # eslint
npm run build             # tsc -b && vite build
```

## Parallelism Map

Phases 1–5 are sequential (each phase's backend gates the next). Within Phase 1,
skill profiles (current) is independent of the board-state/projects/approvals API work.
