# Migration note — user customization layer: Cloud SQL → git branches

**Status:** accepted · 2026-06-17
**Supersedes:** the "per-user copy in Cloud SQL + nightly GCS snapshot" plan
**Driver:** conform Birdie to Sterling Enterprise's *The AI Brain* reference
architecture (owner: Anthony Karls; for Nate Hammell & the build team).

---

## Why this changes

*The AI Brain* splits the system into two machines that connect **only** at a
human-reviewed gate:

- **Distribution machine** — deterministic, *git-versioned*, top-down. Master →
  department nodes → user branches, capability narrowing at each step. Skills,
  prompts, MCP configs, and tool scopes are "the brain's code" and **live in
  git** — *"versioned, diffable, branchable, rollback-able. Not a database;
  don't overthink the storage here."*
- **Learning machine** — observational, evaluated, bottom-up (trace → evaluate →
  curate → improve → gate → redeploy). Separate infrastructure. **The learning
  side never writes directly to the distribution side.**

Our earlier plan stored the per-user contract in **Cloud SQL** and rebuilt
history via a **nightly GCS snapshot** — i.e. we were reinventing version
control that git provides for free, and putting distribution-side state in a
database the doc explicitly steers away from. This note realigns the
**distribution** layer to git. (Tracing/observability is a *separate* concern,
handled in Phase 1 via the trace store — not git, not this note.)

## What we keep (already built, already conformant)

- The capability lives in git: [orchestrator/src/control-plane/departments.ts](../orchestrator/src/control-plane/departments.ts),
  [mcpServers.ts](../orchestrator/src/control-plane/mcpServers.ts),
  [departments/*.md](../orchestrator/departments/).
- **Org non-negotiables stay in code** and are prepended at runtime to every
  agent — never part of any editable, per-user layer.
- The **`canUseTool` approval funnel** stays as the runtime gate on outbound
  actions. (Note: this is the *action* gate. It is **not** the doc's
  *promotion* gate, which gates learnings into master and is not built yet.)
- Per-node scoping from day one (each head's `tools` allowlist; CEO is
  delegate-only).

## What we drop

- ❌ Cloud SQL `agent_contracts` table (the per-user editable copy).
- ❌ `gs://birdie-contracts/base/` base bucket and the per-user backup bucket.
- ❌ Nightly Cloud Scheduler → Cloud Run Job snapshot/revert job.
- ❌ "Slice 1 (schema + contract store)" as previously scoped — paused/dropped.

Git replaces all of the above: history, diff, rollback, and (later) gated
promotion are native.

## The new model

```
capability monorepo (git)
  master            ← the brain's defaults: contracts, skills, MCP configs, scopes
  nodes/<node>      ← scoped subset for a department node (narrower than master)
  user/<userId>     ← per-user branch off the node: explicit customizations only
```

- **Layering at runtime:** effective config = `master` defaults → `node` scope →
  `user/<userId>` customizations, then **locked non-negotiables prepended in
  code**. The agent is composed from that and run via the Agent SDK.
- **"Explicit edits only"** = a commit to the user's branch, made by the
  workbench on the user's behalf. Auditable by construction (git blame/log).
- **Provision on sign-in:** branch `user/<userId>` from the user's node branch
  (empty diff initially — they inherit node scope until they customize).
- **History / revert:** native git — `git log` / `git revert` on the user
  branch. No snapshot job.
- **Promotion (Phase 3, not now):** a user-branch improvement is proposed up
  through the node toward master via a reviewed merge that must pass the eval
  gate, with a named human owner. Redeploy on merge. The learning machine feeds
  *candidates* into this gate; it never writes to git directly.

## Open design choice (needs a decision before implementation)

The doc says "user **branches**." Two faithful implementations, different
tradeoffs:

1. **Literal per-user git branches** (recommended). True isolation; clean
   promotion semantics (PR: `user/<id>` → `nodes/<node>` → `master`); matches the
   doc's mental model exactly. Runtime resolution reads from a **server-side bare
   clone** via `git show user/<id>:<path>` (no working-tree checkout per user) or
   the git provider's contents API — so N users ≠ N working trees.
2. **Per-user files keyed by `userId` on shared branches.** Simpler runtime
   reads, still versioned, but "branch" becomes metaphorical and promotion
   semantics get murkier.

Recommendation: **(1)** for the promotion/governance payoff, with bare-clone
reads at runtime to avoid checkout overhead.

## Boundary to preserve

The **learning** side (traces, eval scores, golden datasets) lives in its own
store and **must not write to this git tree**. Runtime prompts/responses go to
the observability store (Phase 1), *not* into user branches. User branches only
ever change through explicit, human-authored commits.
