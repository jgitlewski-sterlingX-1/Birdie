#!/usr/bin/env bash
# Bootstrap / update the Relay Node API on the Cloudways server.
# Idempotent: safe to re-run for redeploys.
#
# Usage:  bash setup-api.sh
# Expects ~/relay-api/relay/kanban/.env to exist (see relay-api.env.example).

set -euo pipefail

REPO="https://github.com/jgitlewski-sterlingX-1/Birdie.git"
SRC_DIR="$HOME/relay-api"
APP_DIR="$SRC_DIR/relay/kanban"

# 1. Clone or update the source (main has the API; the deploy branch does not).
if [ -d "$SRC_DIR/.git" ]; then
  echo "==> Updating existing checkout"
  git -C "$SRC_DIR" fetch origin main
  git -C "$SRC_DIR" reset --hard origin/main
else
  echo "==> Cloning repo"
  git clone --branch main --depth 1 "$REPO" "$SRC_DIR"
fi

# Load nvm if present (Cloudways non-interactive SSH doesn't auto-source it).
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
fi

cd "$APP_DIR"

# 2. Install only runtime deps (express, cors, googleapis, mysql2, uuid, dotenv).
#    The `prepare` hook is `husky || true`, so this won't fail without devDeps.
echo "==> Installing dependencies"
npm install --omit=dev --no-audit --no-fund

# 3. Verify env exists.
if [ ! -f "$APP_DIR/.env" ]; then
  echo "ERROR: $APP_DIR/.env missing. Copy deploy/relay-api.env.example and fill it in." >&2
  exit 1
fi

# 4. pm2 is installed GLOBALLY (not in package.json), so a local `npm install`
#    can't prune it. Use an isolated PM2_HOME so this app's daemon never clashes
#    with other apps' pm2 on a shared server.
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installing pm2 globally"
  npm install -g pm2 --ignore-scripts --no-audit --no-fund
fi
export PM2_HOME="$HOME/.pm2-relay"

# The app requires Node 20+: google-auth-library's ID-token verification uses
# the global Web Crypto API, which Node <20 doesn't expose by default (causes
# "crypto is not defined" in the OAuth callback). Run the app under Node 20 even
# if pm2 itself runs under another version. (pm2 reload keeps the existing
# interpreter, so --interpreter only applies on first start.)
NODE20="$(nvm which 20 2>/dev/null || command -v node)"

echo "==> Starting/reloading API under pm2 (interpreter: $NODE20)"
pm2 reload relay-api 2>/dev/null || pm2 start server/index.mjs --name relay-api --interpreter "$NODE20" --time
pm2 save

# 5. Schema: the API auto-creates all tables on startup when MYSQL_* is set
#    (ensureCoreSchema + initFlagSchema). To pre-provision the database itself,
#    run once:  npm run db:init

echo "==> Done. API should be live on 127.0.0.1:${RELAY_API_PORT:-8787}"
echo "    Check:  curl -s http://127.0.0.1:8787/api/auth/session | head"
