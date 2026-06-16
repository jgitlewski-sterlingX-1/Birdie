# Relay Kanban Prototype

Prototype UI for Relay with local state and Gmail OAuth integration scaffold.

## Run the app

1. Add Gmail OAuth env vars to a local env file loaded by the server.
2. Start frontend + API server:

```bash
npm run dev:full
```

Frontend: `http://localhost:5173`
API server: `http://localhost:8787`

## Required environment variables

Set these before testing Gmail connect:

```bash
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REDIRECT_URI=http://localhost:8787/api/integrations/gmail/callback
RELAY_API_PORT=8787
```

## Google OAuth setup

Create an OAuth client in Google Cloud Console and add this redirect URI:

`http://localhost:8787/api/integrations/gmail/callback`

Scopes used by the prototype:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.compose`
