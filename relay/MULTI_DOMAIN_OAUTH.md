# Multi-Domain OAuth Setup for Relay

**Public URL:** `https://relay.sterlingx.com`  
**Email Domains:** `rocketclicks.com` and `sterlinglawyers.com`  
**Infrastructure:** rocketclicks.com GCP org (shared database)  
**Status:** Setup guide (implementation required)

---

## Overview

Relay serves both companies from **rocketclicks.com** infrastructure, but is accessed via **sterlingx.com** domain:

```
@rocketclicks.com         @sterlinglawyers.com
     ↓                               ↓
  Browser                         Browser
     ↓                               ↓
  https://relay.sterlingx.com (DNS points to rocketclicks.com servers)
     ↓                               ↓
  OAuth App (rocketclicks.com GCP org)
     ↓
  Shared Database (rocketclicks.com)
     ↓
  Relay Board (both companies see same cards/projects)
```

**Key Principle:** Both domains authenticate against a single OAuth app; the `hd` (hosted domain) parameter allows you to restrict logins to users from either domain or both.

---

## Prerequisites

### 1. GCP Project Setup

In **rocketclicks.com's GCP org**:
- [ ] Create or select a GCP project (e.g., `relay-prod`)
- [ ] Enable APIs:
  - [ ] Google Identity (OAuth 2.0)
  - [ ] Gmail API (if email ingestion needed)
  - [ ] Google Admin API (optional, for user/group sync)

### 2. DNS / Domain Hosting

- [ ] **sterlingx.com:** Ensure you can create subdomains (e.g., `relay.sterlingx.com`)
- [ ] **sterlingx.com DNS:** Point `relay.sterlingx.com` to rocketclicks.com infrastructure (ask your DevOps team for the A record or CNAME)
- [ ] **rocketclicks.com & sterlinglawyers.com:** Both verified in Google Workspace (for OAuth domain validation)

---

## Step 1: Create OAuth 2.0 Credentials in GCP

1. Go to **GCP Console** → **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **OAuth 2.0 Client IDs**
3. Choose application type: **Web Application**
4. Fill in:
   - **Name:** `Relay Multi-Domain`
   - **Authorized JavaScript origins:**
     - `https://relay.sterlingx.com`
     - `http://localhost:5174` (dev)
   - **Authorized redirect URIs:**
     - `https://relay.sterlingx.com/api/integrations/gmail/callback`
     - `http://localhost:8787/api/integrations/gmail/callback` (dev)
5. Click **Create**
6. Download the JSON and extract:
   - `client_id`
   - `client_secret`

---

## Step 2: Configure OAuth Consent Screen

1. Go to **GCP Console** → **APIs & Services** → **OAuth consent screen**
2. Choose **Internal** or **External** app type:
   - **Internal** (preferred if both orgs are Google Workspace): Faster approval, no public verification
   - **External:** Full verification required by Google
3. Fill in app details:
   - **App name:** `Relay`
   - **User support email:** `admin@rocketclicks.com`
   - **Authorized domains:**
     - `rocketclicks.com`
     - `sterlinglawyers.com`
4. **Scopes:** Add the following (OAuth server will request them on login):
   - `openid` (standard)
   - `email` (get user email)
   - `profile` (get user name)
   - (Optional) `https://www.googleapis.com/auth/gmail.readonly` (for email ingestion)

---

## Step 3: Environment Configuration

Update `.env` in the `kanban/` folder with:

```bash
# OAuth (from GCP console, rocketclicks.com GCP org)
GMAIL_CLIENT_ID=<your-client-id-from-step-1>
GMAIL_CLIENT_SECRET=<your-client-secret-from-step-1>
GMAIL_REDIRECT_URI=https://relay.sterlingx.com/api/integrations/gmail/callback

# Multi-Domain Settings
# Email domains that can authenticate to Relay
ALLOWED_DOMAINS=rocketclicks.com,sterlinglawyers.com

# Public URL for CORS and redirects
RELAY_PUBLIC_URL=https://relay.sterlingx.com
RELAY_API_PORT=8787

# Database (rocketclicks.com infrastructure, to be configured)
DATABASE_URL=postgresql://user:pass@db.rocketclicks.com/relay_prod

# Optional: Gmail Ingestion
GMAIL_SYNC_ENABLED=false
```

---

## Step 4: Server-Side Domain Validation

Update `server/index.mjs` to validate that incoming users are from authorized domains:

```javascript
// After OAuth callback
const { email, hd } = payload; // hd = hosted domain
const allowedDomains = (process.env.ALLOWED_DOMAINS || '').split(',');

if (!allowedDomains.includes(hd)) {
  return res.status(403).json({ error: 'Domain not authorized' });
}

// Safe to proceed: user is from rocketclicks.com or sterlinglawyers.com
```

---

## Step 5: Frontend Domain Awareness (Optional)

If you want to show which domain a user is from in the UI, store the domain in the session:

**server/index.mjs:**
```javascript
gmailState.userDomain = new URL(email).domain; // Extract domain from email
```

**src/session.tsx:**
```typescript
interface User {
  id: string;
  name: string;
  email: string;
  domain?: 'rocketclicks.com' | 'sterlinglawyers.com'; // Optional
}
```

---

## Step 6: Deployment

Once OAuth app is created:

1. **DNS:** Point `relay.rocketclicks.com` to your hosting (GCP Cloud Run, AWS, etc.)
2. **Database:** Set up PostgreSQL or similar on rocketclicks.com infrastructure
3. **Server:** Deploy `server/index.mjs` alongside the React frontend
4. **Environment:** Inject OAuth credentials via:
   - `.env` file (dev)
   - Cloud Secret Manager (prod, recommended)
   - Or environment variables in your hosting platform

---

## Security Checklist

- [ ] OAuth credentials stored in Secret Manager, not in Git
- [ ] `GMAIL_REDIRECT_URI` matches exactly what's in GCP console
- [ ] HTTPS enforced on production domain
- [ ] Domain validation on every OAuth callback
- [ ] CORS configured to allow only `rocketclicks.com` and `sterlinglawyers.com`
- [ ] Database credentials encrypted at rest

---

## Testing

### Local Dev (localhost)

In `.env` (for dev at localhost:8787 and localhost:5174):
```
GMAIL_REDIRECT_URI=http://localhost:8787/api/integrations/gmail/callback
RELAY_PUBLIC_URL=http://localhost:5174
ALLOWED_DOMAINS=rocketclicks.com,sterlinglawyers.com
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174
```

Then test login with `@rocketclicks.com` and `@sterlinglawyers.com` test accounts.

### Production Testing

1. Create test users in both Google Workspace orgs
2. Login to `https://relay.rocketclicks.com` with a `@sterlinglawyers.com` email
3. Verify both users see the same board/data
4. Verify logout clears session

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `redirect_uri_mismatch` | URL in callback doesn't match GCP console | Verify exact HTTPS/HTTP, domain, port match |
| Domain users can't login | `hd` validation failing | Check `ALLOWED_DOMAINS` env var; verify spelling |
| CORS errors on OAuth | Frontend origin not in GCP console | Add both domains to "Authorized JavaScript origins" |
| Token expires | Session TTL too short | Increase `SESSION_MAX_AGE` in server config |

---

## Next Steps

1. [ ] Create OAuth app in rocketclicks.com GCP org (steps 1–2)
2. [ ] Extract credentials (CLIENT_ID, CLIENT_SECRET)
3. [ ] Update `.env` in `kanban/` with sterlingx.com URLs
4. [ ] Configure sterlingx.com DNS to point to rocketclicks.com servers
5. [ ] Deploy server to rocketclicks.com infrastructure
6. [ ] Test multi-domain login flow (users from both @rocketclicks and @sterlinglawyers)
7. [ ] Migrate from localStorage to PostgreSQL (Phase 2 of BUILD_SPEC)
