# DECISIONS.md — Relay

This file logs every decision made during the build where CLAUDE.md, BUILD_SPEC.md,
and the prototype conflicted or were ambiguous. Each entry must be logged here
rather than silently resolved.

## Log

| # | Date | Area | Question | Decision | Rationale |
|---|---|---|---|---|---|
| 1 | 2026-06-16 | OAuth / Deployment | Multi-domain authentication for `rocketclicks.com`, `sterlinglawyers.com`, served at `relay.sterlingx.com` | **Option 2 (Internal App + Allowlist)**: OAuth app created in rocketclicks.com GCP org; public domain is sterlingx.com (DNS points to rocketclicks.com servers); both email domains allowed in OAuth consent. Single app, shared database. | rocketclicks.com owns infrastructure; sterlingx.com is public domain; simpler than full external verification. Faster to market, reduces operational overhead. |
