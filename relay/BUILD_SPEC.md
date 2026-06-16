# Build Spec — Relay (production build)

> **Product name:** Relay. **Served at:** `relay.sterlingx.com` (subdomain of `sterlingx.com`), hosted on GCP.

> **Purpose of this document.** A working prototype exists (this `kanban/` app — Vite + React + TypeScript, all state in `localStorage`). It validates the UX and data model. This spec turns that prototype into a real multi-user product. It is written to be handed to Claude to start the initial build.

> **The prototype is the source of truth for UX and behavior.** When this spec says "as in the prototype," open the referenced file. Reuse the React UI; replace the persistence/integration layers.

---

## 1. Product summary

**Relay** is an internal **triage workspace** for **Sterling Lawyers**. Incoming work from **Gmail, Slack, and Salesforce** is classified by AI into **cards** on a kanban **board**. Each card carries context (the email thread, the Slack message, the SF task) plus AI-generated **summary** and **subtasks**. Users act on cards — reply, draft, complete — and **every outbound action requires explicit human approval and is logged to an immutable audit trail**. Cards can be grouped into **projects**; classification behavior is governed by **skills** (shared base skills + per-user custom skills).

- **Served at:** `relay.sterlingx.com` (subdomain of `sterlingx.com`).
- **Hosting:** **Google Cloud Platform**, in the GCP project under the `sterlingx.com` org. All infrastructure stays in that GCP org (billing, IAM, data residency).
- **Users:** internal, ~100 users — Sterling Lawyers staff. **Which Workspace domain they sign in with (`sterlinglawyers.com` vs `sterlingx.com`) is an open question (§10)** and determines whether the "Internal" OAuth shortcut applies (see §6). The serving domain (`sterlingx.com`) and the users' identity domain are independent.
- **Load:** trivial. This is a prototype→product transition, **not** a scaling problem.
- **Defining principle:** AI proposes, the human approves. Nothing leaves the tool without an approval, and every approval is recorded.

### Goals

- Unify Gmail/Slack/Salesforce triage into one board with AI classification.
- Human-in-the-loop approval for all outbound actions, with a tamper-evident audit log.
- Per-user customization of classification via skills.
- Multi-user, authenticated, server-persisted, secure with email content.

### Non-goals (v1)

- Public/external users or multi-org tenancy (single Workspace org only).
- Sending email directly (we create **drafts** only; the user sends from Gmail).
- Mobile-native apps (responsive web is enough).
- Real-time collaborative editing.

---

## 2. Recommended stack — Google Cloud Platform

All hosted in Sterling Lawyers' GCP project, single region.

| Layer | Choice (GCP-native) | Notes |
|---|---|---|
| Frontend | **Keep the prototype's React + TS UI** | Reuse components; swap store internals (below). |
| App framework / host | **Next.js in a container on Cloud Run** | Serverless containers, scales to zero, simple deploys. API routes + frontend in one image. |
| Database | **Cloud SQL for PostgreSQL** | Managed Postgres. Connect from Cloud Run via the Cloud SQL connector / private IP. Implement per-user scoping in the app (and/or Postgres RLS). |
| Auth (app login) | **Google Workspace SSO**, enforced by **Identity-Aware Proxy (IAP)** in front of Cloud Run; access granted to a **Google Group** managed in the **Google Admin console** | Uses existing Google accounts — **no separate user store**. IAP passes the authenticated identity to the app (`X-Goog-Authenticated-User-Email`), used for approval attribution. Who can use Relay is controlled by Group membership in the Admin console. The **API itself is also token-authenticated** (verifies Google ID tokens) so non-browser clients (a future mobile app) can call it — see §2.1. |
| Background sync | **Cloud Scheduler → Cloud Run job** (or Pub/Sub + Cloud Tasks) | Polls each connected account; writes cards. |
| AI | **Claude via Vertex AI (Model Garden)** — GCP-native; or the Anthropic API directly | Vertex keeps billing/IAM/data in GCP. Base + custom skills. Keys never on client. |
| Secrets | **Secret Manager**; OAuth tokens encrypted with **Cloud KMS** | OAuth client secrets + model creds server-only. |
| Container build/deploy | **Cloud Build → Artifact Registry → Cloud Run** | CI/CD pipeline. |
| Custom domain | `relay.sterlingx.com` → Cloud Run (domain mapping or external HTTPS load balancer) | DNS managed under `sterlingx.com`; managed TLS cert. |

**Migration seam:** the prototype isolates all persistence behind hooks — `useBoard` (`src/store.ts`), `useProjects` (`src/projectsStore.ts`), `useSkills` (`src/skillsStore.ts`), `useApprovals` (`src/approvalsStore.ts`), `useSession` (`src/session.tsx`). Reimplement these to call the API with the **same return shapes** and the UI works unchanged.

### 2.1 API-first & mobile-ready

Build **API-first**: the backend is a clean JSON API; the web SPA is just one client.

- The web app and any mobile app are **peer clients of the same API**, sharing the **TypeScript domain model** (§3).
- Mobile options when wanted: a **PWA** (installable web app, lowest cost) or **React Native / Expo** (native, reuses types + API).
- **Auth implication:** IAP (the web login gate) is browser-oriented and awkward for native apps. So the **API must be token-authenticated** — it verifies a **Google ID token** as a bearer token — in addition to IAP fronting the web. A mobile client signs in with Google on-device and sends that token. This costs little now and avoids a painful retrofit later.

### 2.2 Infrastructure — GCP vs. external

**In GCP** (the `sterlingx.com` org's project):

| Component | Role |
|---|---|
| Cloud Run | App + API container |
| Cloud SQL (PostgreSQL) | Primary database |
| Secret Manager | OAuth client secrets, API keys |
| Cloud KMS | Encrypts stored OAuth/refresh tokens |
| Cloud Scheduler + Cloud Run Jobs | Background sync workers |
| Artifact Registry + Cloud Build | Container builds / CI-CD |
| Identity-Aware Proxy + Cloud Load Balancing | Web login gate + ingress |
| Cloud DNS + managed TLS | `relay.sterlingx.com` |
| Cloud Logging / Monitoring | Observability, audit |
| Vertex AI **(optional)** | Claude inference kept inside GCP |

**Outside GCP** (external SaaS APIs Relay calls):

| Dependency | Role |
|---|---|
| Gmail API (user Workspace) | Email ingest + draft creation (per-user OAuth) |
| Slack API | Message ingest + replies (internal Slack app) |
| Salesforce API | Task sync + updates (Connected App, §6) |
| Anthropic API **(only if not using Vertex)** | Claude inference |

---

## 3. Domain model

Derived from the prototype's `src/types.ts`. Production adds ownership (`userId`), external identity (`provider`/`externalId`) for dedupe, and timestamps.

### Card

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `userId` | uuid | owner; **every query is scoped by this** |
| `title` | text | |
| `description` | text? | for non-email cards (editable) |
| `source` | enum `user\|slack\|salesforce\|gmail` | origin |
| `provider` / `externalId` | text? | for ingested cards — dedupe key (e.g. gmail threadId) |
| `assigneeId` | uuid? | a User |
| `client` | json? | `{ name, company? }` |
| `dueDate` | date? | |
| `priority` | enum `low\|medium\|high`? | |
| `projectId` | uuid? | most cards are one-off (null) |
| `routedFrom` | json? | `{ name, userId?, note?, at? }` |
| `parentId` | uuid? | set on a subtask |
| `columnId` | uuid? | null for subtasks |
| `position` | int | order within column or parent |
| `completed` | bool | checklist "done" state |
| `createdAt` / `updatedAt` | timestamptz | |
| `emailThread` | json[] | `[{ from, date, body }]` |
| `attachments` | json[]? | `[{ name, url }]` |
| `summary` | text? | AI summary of the thread |
| `sourceUrl` | text? | deep link to original |
| `replyMeta` | json? | `{ threadId, to, subject, messageId? }` |
| `todosExtracted` | bool | idempotency flag for skill runs |
| `draft` | text? | composed reply/draft body |
| `draftStatus` | enum `draft-saved\|sent`? | |
| `completionNotes` | text? | Salesforce |

### Column

`{ id, userId, title, position }` — each user has their own board. Cards reference `columnId` + `position`.

> Note: prototype stores the board as `{ columns[], cards{} }` with `cardIds[]` per column. In Postgres, normalize: cards carry `columnId` + `position`; subtasks carry `parentId` + `position`.

### Project

`{ id, userId, name, description?, color, createdAt }`. Cards reference `projectId`.

### User

`{ id, email, name, avatarColor, createdAt }`. Real identity from Google sign-in. Replaces the prototype's hardcoded `USERS` + `currentUser()`.

### Skill

`{ id, userId?, name, category (email|slack|salesforce), kind (base|custom), description, instructions, enabled, updatedAt }`. **Base skills** are global (no `userId`), read-only, inherited by all. **Custom skills** belong to a user and extend the base skill.

### ApprovalLogEntry (immutable, append-only)

`{ id, userId, cardId, cardTitle, source, action, messagePreview, approvedById, approvedByName, approvedAt, externalRef? }`. `externalRef` is the id returned by the real send. **Never updatable or deletable.**

### IntegrationConnection

`{ id, userId, provider (gmail|slack|salesforce), status, scopes, encryptedTokens, accountEmail, lastSyncedAt, syncCursor }`. Holds per-user OAuth tokens (**encrypted at rest**) and sync state.

---

## 4. Functional requirements

All implemented and validated in the prototype — match their behavior.

### 4.1 Board

Columns with add/rename/delete; cards with add/delete; drag-and-drop within and across columns. Card face shows: source badge, client, priority pill, due date (red when overdue), routed chip, subtask count, assignee avatar, project chip.

### 4.2 Card detail — lightbox modal

Centered modal, two columns. Closes on backdrop/Escape. Sub-cards open in-place with a breadcrumb back to the parent.

- **Email cards**: AI Summary → most recent message (full) + "View original" → Subtasks checklist → Reply composer. Details rail: assignee, priority, due date, client, project, attachments.
- **Other cards**: editable description → source action → subtasks. Same Details rail.

### 4.3 Subtasks = sub-cards

A subtask is a **full card** (`parentId` set) with every capability of a top-level card, recursively. Rendered as a checklist: checkbox (`completed`), inline-rename, delete, and an "open" affordance. Done/total count in the heading.

### 4.4 Metadata

Client (name/company), due date, priority, assignment, and **routed-from** callout.

### 4.5 Source-specific actions — all gated behind approval

- **Gmail**: compose a reply → approve → **create a Gmail draft** (never send).
- **Slack**: compose a reply → approve → post to the thread.
- **Salesforce**: completion notes + reassign → approve → mark task complete.

Approval UX: a confirmation panel shows the exact content; the action runs **only on explicit approve**, and on success writes an audit-log entry (with the real `externalRef`). On failure, surface the error and do **not** mark approved.

### 4.6 Projects

Create/rename/describe/delete projects; assign a card via the modal's Project dropdown. Projects page lists each project with its cards, a done/total progress bar, and "+ Add a card."

### 4.7 Skills

Settings → Skills tab: summary counts, per-category groups. Base skills are read-only; custom skills support create/edit/delete + enable toggle.

Settings → Approval log tab: the audit trail (read-only in production).

### 4.8 Session / current user

Sidebar shows the signed-in user. **Replace the prototype's user switcher with the Workspace SSO identity** (from IAP). No in-app login screen.

### 4.9 Navigation

Sidebar: **Board**, **Projects**, **Settings**.

---

## 5. AI / Skills behavior

Production replaces prototype heuristics with **server-side Claude calls** (Vertex AI). Inputs/outputs and UI stay the same.

- **Classification**: classify incoming items (ACTION_NEEDED / FYI / NOISE), extract intent + urgency.
- **Email summary**: short summary → `Card.summary`.
- **To-do extraction**: pull action items → create as subtasks (`todosExtracted` flag, idempotent).
- **Custom skills feed the prompt**: user's enabled custom skills augment the base skill's instructions.
- **Where it runs**: server-side at ingestion time, never on client load. Cost-control: batch, cap, cache.

---

## 6. Integrations

**Direct REST APIs, no MCP.** Relay's backend calls each vendor's REST API directly.

### Gmail

- OAuth scopes: `gmail.readonly` (ingest) + `gmail.compose` (create reply drafts). No send.
- Tokens stored server-side, **encrypted**; refresh handled server-side.
- Sync: poll primary inbox per user on a cron; dedupe by `threadId`.
- Actions: **create draft** in the original thread.

### Slack

- Internal Slack app. Read messages/threads that mention the user; post replies on approval.

### Salesforce

- **Connected App with per-user OAuth** (Authorization Code flow) — not a single service user.
- Sync assigned tasks on a schedule; on approval, add completion notes / mark complete.
- Least privilege: request minimal scopes (`api`, `refresh_token`, `offline_access`).

---

## 7. Security & compliance

- **Per-user isolation**: every row carries `userId`; every query is scoped. Enforce in app layer **and** with Postgres row-level security.
- **Token & secret management**: OAuth tokens encrypted at rest with **Cloud KMS**; secrets in **Secret Manager**, never shipped to the client.
- **Audit log integrity**: append-only and immutable — no update/delete endpoints, no "clear log."
- **Data minimization**: prefer re-fetching message bodies over warehousing. Define a retention policy.
- **Domain lock**: auth restricted to the users' Workspace domain.

---

## 8. API surface

All endpoints authenticated; all data scoped to the session user.

- `GET /api/board` → columns + cards; `POST/PATCH/DELETE /api/cards`; `POST /api/cards/:id/move`
- `GET/POST/PATCH/DELETE /api/projects`; `POST /api/projects/:id/cards`
- `GET/POST/PATCH/DELETE /api/skills` (custom only; base read-only)
- `GET /api/approvals`, `POST /api/approvals` (append-only)
- `GET /api/integrations`, `POST /api/integrations/:provider/connect`, `POST /api/integrations/:provider/sync`
- **Action endpoints** (real outbound call + atomic approval log write):
  - `POST /api/cards/:id/gmail-draft` `{ body }`
  - `POST /api/cards/:id/slack-reply` `{ body }`
  - `POST /api/cards/:id/salesforce-complete` `{ notes }`
- `GET /healthz`, `GET /readyz`

---

## 9. Phased delivery

1. **Backend foundation** — Postgres schema, Next.js API, Google sign-in, repoint five hooks, seed base skills + default columns.
   - **Done when:** user signs in, empty board, can create/move/edit cards/projects/subtasks/skills — all persisted server-side, isolated per user.

2. **Gmail integration** — OAuth app, encrypted tokens, sync worker, real draft creation on approval.
   - **Done when:** Gmail ingests real threads as cards; approving a reply creates a real draft with an approval-log entry carrying the draft id.

3. **Real skills** — server-side Claude for classification, summary, subtask extraction; custom skills feed the prompt.
   - **Done when:** ingested cards have model-generated summaries/subtasks/classification.

4. **Slack + Salesforce** — sync + approval-gated actions mirroring Gmail.

5. **Harden & deploy** — append-only log enforced, Postgres RLS, full deploy pipeline, observability + analytics live.

> **Cross-cutting:** monitoring/alerting (§11) and usage-event instrumentation (§12) are added incrementally from Phase 1 — not deferred to Phase 5.

---

## 10. Open questions to confirm before building

- **Users' Workspace domain (critical):** `sterlinglawyers.com` or `sterlingx.com`?
- **GCP project & org:** confirm target GCP project id/region.
- **AI runtime:** Vertex AI (recommended) vs. Anthropic API directly.
- **Mobile app in scope?**
- **Salesforce object scope:** Tasks only, or also Cases/Matters?
- **Reliability targets & on-call tool.**
- **Analytics stack:** BigQuery + Looker Studio assumed.
- **Projects scope:** per-user or shared team projects?
- **Board model:** one board per user, or shared team boards?
- **Card ownership when routed:** reassign `userId` or just annotate `routedFrom`?
- **Retention:** how long to keep ingested content.

---

## 11. Observability, monitoring & alerting

- `/healthz` (liveness) + deep readiness check (DB + each integration's last-sync status).
- Structured logs → Cloud Logging; Error Reporting; Cloud Trace.
- Alerting on: app failures, 5xx spikes, latency-SLO breach, Cloud SQL issues, per-user OAuth token-refresh failures, sync-job failures, outbound action failures, AI cost spikes.
- Synthetic end-to-end probe for silent pipeline failures.
- In-app integration status surface ("your Gmail connection expired — reconnect").

---

## 12. User analytics & adoption

**Usage metadata only, never email/Salesforce content.**

- Pipeline: backend emits `{ event, userId, ts, properties }` → **Pub/Sub → BigQuery** → Looker Studio.
- Events: `app_opened`, `card_opened`, `card_triaged`, `reply_drafted`, `reply_approved`, `sf_task_completed`, `subtask_completed`, `project_created`, `skill_created`, `integration_connected{provider}`.
- Metrics: DAU/WAU/MAU, % provisioned users active, time-to-first-action, feature-usage breadth, items triaged per user.

---

## 13. Cost & sizing

~100 internal users, business-hours load. AI inference dominates.

**Cost levers (architecture, not later tuning):**
1. **Pre-filter before Claude** — drop NOISE with cheap rules; run full skill only on ACTION_NEEDED items.
2. **Tier models** — Haiku-class for bulk classification; stronger model for summaries/drafts.
3. **Cache & dedupe** per thread (`todosExtracted` flag).
4. **Batch** ingestion; set Cloud Billing budget alerts.
5. Right-size Cloud SQL; use committed-use discounts.

---

## 14. Reference — prototype file map (UX source of truth)

| Area | File |
|---|---|
| Domain types | `src/types.ts` |
| Board state + mutations | `src/store.ts` (`useBoard`) |
| Projects | `src/projectsStore.ts`, `src/pages/ProjectsPage.tsx` |
| Skills | `src/skills.ts`, `src/skillsStore.ts`, `src/pages/SettingsPage.tsx` |
| Approvals/audit | `src/approvalsStore.ts`, `src/components/ApprovalLogView.tsx` |
| Session/current user | `src/session.tsx` |
| Card detail | `src/components/CardModal.tsx` |
| Card face | `src/components/CardItem.tsx`, `src/components/ColumnView.tsx` |
| Email skill | `src/emailSkill.ts` |
| Gmail integration | `src/gmail.ts`, `src/components/GmailConnect.tsx` |
| Sources / priorities / users | `src/sources.ts`, `src/priorities.ts`, `src/users.ts` |
| Nav / shell | `src/components/Sidebar.tsx`, `src/App.tsx` |

> Run the prototype (`cd kanban && npm install && npm run dev`) to see any behavior in action before reimplementing it.
