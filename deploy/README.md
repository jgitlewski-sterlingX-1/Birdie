# Relay — Cloud Run deployment

**Production URL:** `https://relay-api-192448251506.us-central1.run.app`

The API runs as a Cloud Run service (`relay-api`) in `us-central1`. The React SPA
is served by the same service — the Express server serves `dist/` as static files
and falls back to `index.html` for client-side routing.

## Environment variables

Set these on the Cloud Run service (Cloud Console → Cloud Run → relay-api →
Edit & Deploy → Variables & Secrets, or via `gcloud run services update`):

| Variable | Description |
|---|---|
| `GMAIL_CLIENT_ID` | Google OAuth client ID |
| `GMAIL_CLIENT_SECRET` | Google OAuth client secret |
| `ANTHROPIC_API_KEY` | Claude API key (email drafting + triage) |
| `SLACK_CLIENT_ID` | Slack app client ID |
| `SLACK_CLIENT_SECRET` | Slack app client secret |
| `ADMIN_EMAILS` | Comma-separated emails granted admin role on first sign-in |
| `ALLOWED_DOMAINS` | `rocketclicks.com,sterlinglawyers.com` |
| `GMAIL_REDIRECT_URI` | `https://relay-api-192448251506.us-central1.run.app/api/auth/callback` |
| `FRONTEND_URL` | `https://relay-api-192448251506.us-central1.run.app` |
| `ALLOWED_ORIGINS` | `https://relay-api-192448251506.us-central1.run.app` |
| `MYSQL_HOST` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | Cloud SQL connection |

## OAuth redirect URIs to register

**Google Cloud Console** → the OAuth client → Authorized redirect URIs:
```
https://relay-api-192448251506.us-central1.run.app/api/auth/callback
```

**Slack app** (api.slack.com/apps) → OAuth & Permissions → Redirect URLs:
```
https://relay-api-192448251506.us-central1.run.app/api/integrations/slack/callback
```

## Deploying

```bash
# from relay/kanban/
npm run build                    # builds dist/
gcloud run deploy relay-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

Or push to `main` to trigger the CI/CD pipeline (`.github/workflows/deploy.yml`).

## Database schema

When `MYSQL_*` is configured, the API creates the entire schema on startup via
`ensureCoreSchema` + `initFlagSchema` (both idempotent — `CREATE TABLE IF NOT
EXISTS`). The `MYSQL_DATABASE` must already exist. With no `MYSQL_*` set, the
API runs on its in-memory fallback (state resets on restart).

## Local dev

```bash
# relay/kanban/.env — see relay-api.env.example for local values
npm run dev:full     # frontend :5173 + API :8787
```
