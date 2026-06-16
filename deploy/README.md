# Relay — Cloudways deployment runbook

The Cloudways app is a **PHP stack**, so the static SPA and the Node API are
deployed separately on the same server and stitched together with an Nginx
reverse proxy:

- **SPA** → Git-deployed branch `cloudways-deploy` → served from the webroot.
- **API** → Node/Express (`relay/kanban/server/index.mjs`) run under pm2 on
  `127.0.0.1:8787`, fronted by Nginx at `/api`.

Same origin means the SPA's relative `/api/...` fetches work with no code change.

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

3. **API env**: copy [relay-api.env.example](relay-api.env.example) to
   `~/relay-api/relay/kanban/.env` on the server and fill in
   `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`.

4. **Bootstrap the API**: `bash setup-api.sh` (clones main, installs runtime
   deps, starts `relay-api` under pm2).

5. **Nginx proxy**: add the block from [nginx-api-proxy.conf](nginx-api-proxy.conf)
   into the app's vhost, then `sudo nginx -t && sudo service nginx reload`.

6. **SPA**: in Cloudways → Deployment via Git, pull branch `cloudways-deploy`
   into the webroot.

## Redeploys

- **SPA change:** rebuild + push `cloudways-deploy`, then Pull in Cloudways.
- **API change:** re-run `bash setup-api.sh` (it resets to origin/main and
  reloads pm2).

## Notes / known issues

- pm2 reboot-persistence (`pm2 startup`) needs sudo; `pm2 save` covers manual
  restarts. Configure startup with master creds if reboot survival is required.
- `getOAuthClient()` shares `GMAIL_REDIRECT_URI` for both the login flow and the
  Settings → "Connect Gmail" flow. It's set to the **login** callback, so the
  login gate works; the Gmail-connect button in Settings would need its own
  redirect URI to function. Out of scope for getting login working.
