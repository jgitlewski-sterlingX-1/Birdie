import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.RELAY_API_PORT || 8787;

// Multi-domain CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:5174']; // Default to dev

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Multi-domain OAuth configuration
const ALLOWED_DOMAINS = process.env.ALLOWED_DOMAINS 
  ? process.env.ALLOWED_DOMAINS.split(',').map(d => d.trim())
  : ['rocketclicks.com', 'sterlinglawyers.com']; // Default for local dev

const {
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REDIRECT_URI = 'http://localhost:8787/api/auth/callback',
  GMAIL_INTEGRATION_REDIRECT_URI = 'http://localhost:8787/api/integrations/gmail/callback',
  FRONTEND_URL = 'http://localhost:5176',
} = process.env;

// Session storage (in-memory; production should use database/Redis)
const sessions = new Map();
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'];
const AUTH_SCOPES = ['openid', 'email', 'profile'];

const gmailAccounts = [];
let defaultGmailAccountEmail = null;

function upsertGmailAccount({
  accountEmail,
  userDomain,
  scopes,
  token = null,
  source,
  setAsDefault = false,
}) {
  const existing = gmailAccounts.find((account) => account.accountEmail === accountEmail);
  const now = new Date().toISOString();

  if (existing) {
    existing.userDomain = userDomain;
    existing.scopes = scopes;
    existing.lastConnectedAt = now;
    existing.token = token;
    existing.source = source;
  } else {
    gmailAccounts.push({
      accountEmail,
      userDomain,
      scopes,
      lastConnectedAt: now,
      token,
      source,
    });
  }

  if (!defaultGmailAccountEmail || setAsDefault) {
    defaultGmailAccountEmail = accountEmail;
  }
}

function getDefaultGmailAccount() {
  if (!defaultGmailAccountEmail) return null;
  return gmailAccounts.find((account) => account.accountEmail === defaultGmailAccountEmail) ?? null;
}

function getOAuthClient(redirectUri = GMAIL_REDIRECT_URI) {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    return null;
  }
  return new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, redirectUri);
}

// Auth endpoints (login / logout / session)
app.get('/api/auth/login', (_req, res) => {
  const oauth2Client = getOAuthClient();
  if (!oauth2Client) {
    return res.status(400).json({
      error: 'Missing OAuth environment variables. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.',
    });
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: AUTH_SCOPES,
  });

  res.json({ authUrl });
});

app.get('/api/auth/callback', async (req, res) => {
  const oauth2Client = getOAuthClient();
  if (!oauth2Client) {
    return res.status(400).send('Missing OAuth env vars.');
  }

  const code = req.query.code;
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!code || typeof code !== 'string') {
    return res.status(400).send('Missing OAuth code.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    if (state === 'gmail_connect') {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });

      const accountEmail = profile.data.emailAddress || null;
      const emailDomain = accountEmail ? accountEmail.split('@')[1] : null;

      if (!emailDomain || !ALLOWED_DOMAINS.includes(emailDomain)) {
        console.warn(
          `[OAuth] Access denied for ${accountEmail}. Domain ${emailDomain} not in allowed list: ${ALLOWED_DOMAINS.join(', ')}`
        );
        return res
          .status(403)
          .send(
            `Access denied. Your domain (${emailDomain}) is not authorized for Relay. Allowed domains: ${ALLOWED_DOMAINS.join(', ')}`
          );
      }

      upsertGmailAccount({
        accountEmail,
        userDomain: emailDomain,
        scopes: GMAIL_SCOPES,
        token: tokens,
        source: 'gmail-connect',
        setAsDefault: !defaultGmailAccountEmail,
      });

      console.log(`[OAuth] Connected via auth callback: ${accountEmail} (domain: ${emailDomain})`);
      return res.redirect(`${FRONTEND_URL}?gmail=connected`);
    }

    // Decode the ID token to get user info; fall back to userinfo if id_token missing
    let payload;
    if (tokens.id_token) {
      const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: GMAIL_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } else {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userinfo = await oauth2.userinfo.get();
      payload = {
        sub: userinfo.data.id,
        email: userinfo.data.email,
        name: userinfo.data.name,
      };
    }

    const email = payload.email || '';
    const name = payload.name || email.split('@')[0];
    const emailDomain = email.split('@')[1];

    // Validate domain
    if (!emailDomain || !ALLOWED_DOMAINS.includes(emailDomain)) {
      console.warn(`[Auth] Access denied for ${email}. Domain ${emailDomain} not in allowed list.`);
      return res
        .status(403)
        .send(`Access denied. Your domain (${emailDomain}) is not authorized for Relay.`);
    }

    // Create session
    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      user: {
        id: payload.sub,
        email,
        name,
        domain: emailDomain,
      },
      createdAt: new Date().toISOString(),
      tokens,
    };
    sessions.set(sessionId, session);

    // Automatically configure the login account for email skill usage.
    upsertGmailAccount({
      accountEmail: email,
      userDomain: emailDomain,
      scopes: AUTH_SCOPES,
      token: null,
      source: 'auth-login',
      setAsDefault: true,
    });

    console.log(`[Auth] Logged in: ${email} (domain: ${emailDomain})`);

    // Redirect back to app with session ID in query params
    return res.redirect(`${FRONTEND_URL}?sessionId=${sessionId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown OAuth error';
    console.error(`[Auth] Callback error: ${message}`);
    return res.status(500).send(`OAuth callback failed: ${message}`);
  }
});

app.get('/api/auth/session', (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.json({ authenticated: false, user: null });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.json({ authenticated: false, user: null });
  }

  res.json({ authenticated: true, sessionId, user: session.user });
});

app.post('/api/auth/logout', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) {
    sessions.delete(sessionId);
  }
  res.json({ ok: true });
});

// Gmail integration endpoints (kept for "Connect Gmail" in Settings tab)
app.get('/api/integrations', (_req, res) => {
  const defaultAccount = getDefaultGmailAccount();

  res.json({
    gmail: {
      status: defaultAccount ? 'connected' : 'disconnected',
      accountEmail: defaultAccount?.accountEmail ?? null,
      userDomain: defaultAccount?.userDomain ?? null,
      lastConnectedAt: defaultAccount?.lastConnectedAt ?? null,
      scopes: defaultAccount?.scopes ?? GMAIL_SCOPES,
      defaultAccountEmail: defaultGmailAccountEmail,
      accounts: gmailAccounts.map((account) => ({
        accountEmail: account.accountEmail,
        userDomain: account.userDomain,
        lastConnectedAt: account.lastConnectedAt,
        scopes: account.scopes,
        source: account.source,
      })),
    },
  });
});

app.get('/api/integrations/gmail/connect', (_req, res) => {
  const oauth2Client = getOAuthClient();
  if (!oauth2Client) {
    return res.status(400).json({
      error: 'Missing Gmail OAuth environment variables. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.',
    });
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    state: 'gmail_connect',
  });

  res.json({ authUrl });
});

app.get('/api/integrations/gmail/callback', async (req, res) => {
  const oauth2Client = getOAuthClient();
  if (!oauth2Client) {
    return res.status(400).send('Missing Gmail OAuth env vars.');
  }

  const code = req.query.code;
  if (!code || typeof code !== 'string') {
    return res.status(400).send('Missing OAuth code.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });

    const accountEmail = profile.data.emailAddress || null;
    
    // Extract domain from email (e.g., "user@rocketclicks.com" → "rocketclicks.com")
    const emailDomain = accountEmail ? accountEmail.split('@')[1] : null;

    // Validate that user's domain is in the allowed list
    if (!emailDomain || !ALLOWED_DOMAINS.includes(emailDomain)) {
      console.warn(
        `[OAuth] Access denied for ${accountEmail}. Domain ${emailDomain} not in allowed list: ${ALLOWED_DOMAINS.join(', ')}`
      );
      return res
        .status(403)
        .send(
          `Access denied. Your domain (${emailDomain}) is not authorized for Relay. Allowed domains: ${ALLOWED_DOMAINS.join(', ')}`
        );
    }

    // Domain is authorized; add/update connected Gmail account.
    upsertGmailAccount({
      accountEmail,
      userDomain: emailDomain,
      scopes: GMAIL_SCOPES,
      token: tokens,
      source: 'gmail-connect',
      setAsDefault: !defaultGmailAccountEmail,
    });

    console.log(`[OAuth] Connected: ${accountEmail} (domain: ${emailDomain})`);

    return res.redirect(`${FRONTEND_URL}?gmail=connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown OAuth error';
    console.error(`[OAuth] Callback error: ${message}`);
    return res.status(500).send(`OAuth callback failed: ${message}`);
  }
});

app.post('/api/integrations/gmail/disconnect', (_req, res) => {
  const accountEmail = _req.body?.accountEmail;

  if (accountEmail && typeof accountEmail === 'string') {
    const index = gmailAccounts.findIndex((account) => account.accountEmail === accountEmail);
    if (index !== -1) {
      gmailAccounts.splice(index, 1);
    }
  } else {
    gmailAccounts.length = 0;
  }

  if (defaultGmailAccountEmail && !gmailAccounts.some((account) => account.accountEmail === defaultGmailAccountEmail)) {
    defaultGmailAccountEmail = gmailAccounts[0]?.accountEmail ?? null;
  }

  res.json({ ok: true, defaultAccountEmail: defaultGmailAccountEmail });
});

app.post('/api/integrations/gmail/default', (req, res) => {
  const accountEmail = req.body?.accountEmail;

  if (!accountEmail || typeof accountEmail !== 'string') {
    return res.status(400).json({ error: 'accountEmail is required' });
  }

  const accountExists = gmailAccounts.some((account) => account.accountEmail === accountEmail);
  if (!accountExists) {
    return res.status(404).json({ error: 'Gmail account not found' });
  }

  defaultGmailAccountEmail = accountEmail;
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Relay API listening on http://localhost:${PORT}`);
  console.log(`[Config] Allowed domains: ${ALLOWED_DOMAINS.join(', ')}`);
  console.log(`[Config] Allowed origins: ${allowedOrigins.join(', ')}`);
});
