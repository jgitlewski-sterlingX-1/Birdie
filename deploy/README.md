# Relay — Cloudways deployment runbook

The Cloudways app is an **Nginx + PHP-FPM stack** with **no sudo and no Nginx
`/api` reverse proxy available**. The SPA and the Node API are stitched together
by a **PHP front-controller** instead:

- **SPA** → built bundle (`relay/kanban/dist/`) → served from the webroot.
- **API** → Node/Express (`relay/kanban/server/index.mjs`) under pm2 on
  `127.0.0.1:8787`.
- **`public/index.php`** (built into `dist/`) reverse-proxies `/api/*` to the
  local Node API and serves `index.html` for everything else.

Same origin means the SPA's relative `/api/...` fetches work with no code change.
**`index.php` must stay in the deployed bundle** — it *is* the `/api` routing on
this stack (there is no Apache/`.htaccess` and no Nginx proxy). Because it lives
in `public/`, Vite includes it in `dist/`, so `rsync --delete` preserves it.

Public URL: `https://phpstack-1565248-6494558.cloudwaysapps.com`

## One-time setup

1. **Add the deploy SSH key** in Cloudways → Server → *SSH Public Keys* (or
   Master Access). Public key (private key stays on the deploy machine):

   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAoVja2uaicl2kN69T48iGrZdjgo3tzsLgUTzXWow5t3 relay-cloudways-deploy
   ```

2. **Google Cloud Console** → the OAuth client → add Authorized redirect URI:

   ```
   https://phpstack-1565248-6494558.cloudwaysapps.com/api/auth/callback
   ```

2b. **Slack app** (api.slack.com/apps) → OAuth & Permissions → Redirect URLs → add:

   ```
   https://phpstack-1565248-6494558.cloudwaysapps.com/api/integrations/slack/callback
   ```

   Set the User Token Scopes (read + send as the user): `channels:history`,
   `channels:read`, `groups:history`, `im:history`, `chat:write`, `users:read`,
   `search:read`. The app must be approved/installed in the workspace.

3. **API env**: copy [relay-api.env.example](relay-api.env.example) to
   `~/relay-api/relay/kanban/.env` on the server and fill in
   `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`, `ANTHROPIC_API_KEY` (email
   drafting), and `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`.

4. **Bootstrap the API**: `bash setup-api.sh` (clones main, installs runtime
   deps, starts `relay-api` under pm2).

5. **`/api` routing**: handled by `public/index.php`, which is built into the SPA
   bundle and deployed with it — **no Nginx/sudo step required** on this stack.
   ([nginx-api-proxy.conf](nginx-api-proxy.conf) is only relevant if you ever gain
   real Nginx vhost access; the PHP front-controller is the supported path here.)

6. **SPA**: handled by CI (below) — it builds `dist/` and rsyncs it (including
   `index.php`) into the webroot.

## CI/CD (GitHub Actions → Cloudways)

`.github/workflows/deploy.yml` deploys on every push to `main`: it builds the
SPA, rsyncs it to the webroot, and runs a server-side API redeploy over SSH.
Add these in the repo's **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `CLOUDWAYS_SSH_KEY` | Private key whose public half is on the Cloudways server |
| `CLOUDWAYS_HOST` | Server host/IP |
| `CLOUDWAYS_USER` | SSH user |
| `CLOUDWAYS_WEBROOT` | Absolute path to the SPA webroot |
| `CLOUDWAYS_API_REDEPLOY_CMD` | see below |

Redeploy command (non-interactive SSH must source nvm; `prepare` is `husky \|\| true`
so `--omit=dev` won't break on the missing husky devDep; `pm2` is global so a local
install can't prune it; the API uses an isolated `PM2_HOME`):

```bash
export NVM_DIR=$HOME/.nvm && . $HOME/.nvm/nvm.sh && nvm use 18 >/dev/null && \
cd ~/relay-api && git fetch origin && git reset --hard origin/main && \
cd relay/kanban && npm ci --omit=dev && \
PM2_HOME=$HOME/.pm2-relay pm2 reload relay-api
```

`nvm use 18` is required: npm's global prefix (where pm2 lives) is pinned to
Node 18, so pm2 is only on `PATH` under that version. Verified end-to-end on the
server.

Releasing is decoupled from deploying: code ships dark and is turned on per role
in the in-app **Settings → Admin** feature-flag panel.

## Database schema

When `MYSQL_*` is configured, the API creates the **entire schema on startup**
— core tables (`users`, `sessions`, `gmail_accounts`, …) via `ensureCoreSchema`
then flags/roles via `initFlagSchema`. Both are idempotent (`CREATE TABLE IF NOT
EXISTS`), so the DB cannot be left half-migrated and no manual migration step is
required. The API only creates tables, not the database itself, so the
`MYSQL_DATABASE` must already exist (the standalone `npm run db:init` creates the
database too — use it to pre-provision). With no `MYSQL_*` set, the API runs on
its in-memory fallback (state resets on restart).

## Redeploys (manual fallback)

- **SPA change:** push to `main` (CI builds + rsyncs `dist/`, including
  `index.php`). Manual: `npm run build` then rsync `dist/` to the webroot.
- **API change:** push to `main` (CI runs the redeploy command). Manual: re-run
  `bash setup-api.sh` (resets to origin/main, installs deps, reloads pm2).

## Notes / known issues

- **pm2 is installed globally**, not in `package.json`. A local `npm install`
  prunes anything not in `package.json`, so a locally-installed pm2 would vanish
  on every redeploy — hence global. The API runs under an isolated
  `PM2_HOME=$HOME/.pm2-relay` so its daemon never clashes with other apps' pm2
  on the shared server.
- **`prepare` is `husky || true`.** husky is a devDep; under `--omit=dev` it
  isn't installed, and a bare `husky` in `prepare` would exit non-zero and abort
  the whole install. The `|| true` makes prod installs (and CI `npm ci`) safe.
- **Node version:** the API **requires Node 20+** — `google-auth-library`'s
  ID-token verification uses the global Web Crypto API, which Node <20 doesn't
  expose by default (running on Node 18 throws `crypto is not defined` in the
  OAuth callback). pm2 itself runs under the Node-18 global prefix, so the app is
  started with `--interpreter <node20>` (see `setup-api.sh`); `pm2 reload`
  preserves that interpreter. `package.json` declares `engines.node >=20`.
- pm2 reboot-persistence (`pm2 startup`) needs sudo; instead an `@reboot` cron
  (`~/relay-api/pm2-boot.sh`) runs `pm2 resurrect`. `pm2 save` keeps the dump current.
- `getOAuthClient()` shares `GMAIL_REDIRECT_URI` for both the login flow and the
  Settings → "Connect Gmail" flow. It's set to the **login** callback, so the
  login gate works; the Gmail-connect button in Settings would need its own
  redirect URI to function. Out of scope for getting login working.
