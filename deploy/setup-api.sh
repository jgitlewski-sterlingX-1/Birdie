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

cd "$APP_DIR"

# 2. Install only runtime deps (express, cors, googleapis, uuid, dotenv).
echo "==> Installing dependencies"
npm install --omit=dev --no-audit --no-fund

# 3. Verify env exists.
if [ ! -f "$APP_DIR/.env" ]; then
  echo "ERROR: $APP_DIR/.env missing. Copy deploy/relay-api.env.example and fill it in." >&2
  exit 1
fi

# 4. Start (or reload) under pm2 — installed locally to avoid global perms.
if [ ! -x "$APP_DIR/node_modules/.bin/pm2" ]; then
  echo "==> Installing pm2 locally"
  npm install pm2 --no-audit --no-fund
fi
PM2="$APP_DIR/node_modules/.bin/pm2"

echo "==> Starting API under pm2"
"$PM2" delete relay-api >/dev/null 2>&1 || true
"$PM2" start server/index.mjs --name relay-api
"$PM2" save

echo "==> Done. API should be live on 127.0.0.1:${RELAY_API_PORT:-8787}"
echo "    Check:  curl -s http://127.0.0.1:8787/api/auth/session | head"
