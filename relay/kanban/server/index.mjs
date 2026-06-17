import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import mysql from 'mysql2/promise';

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
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DATABASE = 'relay',
  MYSQL_SOCKET_PATH,
} = process.env;

// Session storage (in-memory; production should use database/Redis)
const sessions = new Map();
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'];
// User-token scopes: read + send as the user (mirrors the email flow).
const SLACK_USER_SCOPES = 'channels:history,channels:read,groups:history,im:history,chat:write,users:read,search:read';
const AUTH_SCOPES = ['openid', 'email', 'profile', ...GMAIL_SCOPES];

const gmailAccounts = [];
let defaultGmailAccountEmail = null;
// In-memory Slack connection (single workspace, like gmailAccounts).
let slackAccount = null;
const seenMessageIdsByAccount = new Map();

const dbPool =
  MYSQL_USER && MYSQL_PASSWORD && (MYSQL_SOCKET_PATH || (MYSQL_HOST && MYSQL_PORT))
    ? mysql.createPool({
        ...(MYSQL_SOCKET_PATH
          ? { socketPath: MYSQL_SOCKET_PATH }
          : { host: MYSQL_HOST, port: Number(MYSQL_PORT) }),
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: MYSQL_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
      })
    : null;

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

function getSessionById(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  return sessions.get(sessionId) ?? null;
}

function getSessionFromRequest(req) {
  const querySessionId = req.query?.sessionId;
  const bodySessionId = req.body?.sessionId;
  const sessionId =
    typeof querySessionId === 'string'
      ? querySessionId
      : typeof bodySessionId === 'string'
      ? bodySessionId
      : null;

  if (!sessionId) return null;
  return getSessionById(sessionId);
}

function decodeBase64Url(input) {
  if (!input || typeof input !== 'string') return '';
  try {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function extractTextBody(payload) {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text.trim()) return text;
    }
  }

  return payload.body?.data ? decodeBase64Url(payload.body.data) : '';
}

function getHeaderValue(headers, name) {
  if (!Array.isArray(headers)) return '';
  const match = headers.find((h) => h?.name?.toLowerCase() === name.toLowerCase());
  return match?.value ?? '';
}

function isAllowedDomain(email) {
  const domain = typeof email === 'string' ? email.split('@')[1] : null;
  return !!domain && ALLOWED_DOMAINS.includes(domain);
}

function getOAuthClient(redirectUri = GMAIL_REDIRECT_URI) {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    return null;
  }
  return new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, redirectUri);
}

async function upsertUserRecord({ googleSub, email, name, domain }) {
  if (!dbPool) {
    return {
      id: googleSub,
      email,
      name,
      domain,
    };
  }

  const [rows] = await dbPool.query(
    'SELECT id, email, name, domain FROM users WHERE google_sub = ? LIMIT 1',
    [googleSub]
  );
  const existing = rows?.[0];

  if (existing) {
    await dbPool.query(
      `
        UPDATE users
        SET email = ?, name = ?, domain = ?, last_login_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [email, name, domain, existing.id]
    );

    return {
      id: existing.id,
      email,
      name,
      domain,
    };
  }

  const userId = uuidv4();
  await dbPool.query(
    `
      INSERT INTO users (id, google_sub, email, name, domain, last_login_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `,
    [userId, googleSub, email, name, domain]
  );

  return {
    id: userId,
    email,
    name,
    domain,
  };
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
    const googleSub = payload.sub || '';

    // Validate domain
    if (!emailDomain || !ALLOWED_DOMAINS.includes(emailDomain)) {
      console.warn(`[Auth] Access denied for ${email}. Domain ${emailDomain} not in allowed list.`);
      return res
        .status(403)
        .send(`Access denied. Your domain (${emailDomain}) is not authorized for Relay.`);
    }

    if (!googleSub) {
      return res.status(500).send('OAuth callback failed: Missing Google subject identifier.');
    }

    const appUser = await upsertUserRecord({
      googleSub,
      email,
      name,
      domain: emailDomain,
    });

    // Create session
    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      user: {
        id: appUser.id,
        email: appUser.email,
        name: appUser.name,
        domain: appUser.domain,
        googleSub,
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
      token: tokens,
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

app.get('/api/users/me/settings', async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized session' });
  }

  if (!dbPool) {
    return res.status(503).json({ error: 'Database is not configured' });
  }

  try {
    const [rows] = await dbPool.query(
      'SELECT settings_json FROM user_settings WHERE user_id = ? LIMIT 1',
      [session.user.id]
    );
    const row = rows?.[0];

    if (!row) {
      await dbPool.query(
        'INSERT INTO user_settings (user_id, settings_json) VALUES (?, ?)',
        [session.user.id, '{}']
      );
      return res.json({ settings: {} });
    }

    const settings = JSON.parse(row.settings_json || '{}');
    return res.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown settings error';
    return res.status(500).json({ error: `Failed to load settings: ${message}` });
  }
});

app.put('/api/users/me/settings', async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized session' });
  }

  if (!dbPool) {
    return res.status(503).json({ error: 'Database is not configured' });
  }

  const settings = req.body?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return res.status(400).json({ error: 'settings object is required' });
  }

  try {
    await dbPool.query(
      `
        INSERT INTO user_settings (user_id, settings_json)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json)
      `,
      [session.user.id, JSON.stringify(settings)]
    );
    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown settings update error';
    return res.status(500).json({ error: `Failed to save settings: ${message}` });
  }
});

app.get('/api/integrations/salesforce', async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized session' });
  }

  if (!dbPool) {
    return res.status(503).json({ error: 'Database is not configured' });
  }

  try {
    const [rows] = await dbPool.query(
      `
        SELECT id, salesforce_user_id, username, org_id, instance_url, scopes_json, status, is_default, connected_at, updated_at, last_synced_at
        FROM salesforce_accounts
        WHERE user_id = ?
        ORDER BY connected_at DESC
      `,
      [session.user.id]
    );

    const accounts = rows.map((row) => ({
      id: row.id,
      salesforceUserId: row.salesforce_user_id,
      username: row.username,
      orgId: row.org_id,
      instanceUrl: row.instance_url,
      scopes: JSON.parse(row.scopes_json || '[]'),
      status: row.status,
      isDefault: !!row.is_default,
      connectedAt: row.connected_at,
      updatedAt: row.updated_at,
      lastSyncedAt: row.last_synced_at,
    }));

    return res.json({
      salesforce: {
        status: accounts.some((a) => a.status === 'connected') ? 'connected' : 'disconnected',
        accounts,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Salesforce status error';
    return res.status(500).json({ error: `Failed to load Salesforce integration: ${message}` });
  }
});

app.post('/api/integrations/salesforce/connect', async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized session' });
  }

  if (!dbPool) {
    return res.status(503).json({ error: 'Database is not configured' });
  }

  const orgId = req.body?.orgId;
  if (!orgId || typeof orgId !== 'string') {
    return res.status(400).json({ error: 'orgId is required' });
  }

  const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes : [];
  const status = ['connected', 'disconnected', 'error'].includes(req.body?.status)
    ? req.body.status
    : 'connected';

  try {
    const [existingDefault] = await dbPool.query(
      'SELECT id FROM salesforce_accounts WHERE user_id = ? AND is_default = 1 LIMIT 1',
      [session.user.id]
    );
    const shouldSetDefault = !existingDefault?.[0];

    await dbPool.query(
      `
        INSERT INTO salesforce_accounts (
          id,
          user_id,
          salesforce_user_id,
          username,
          org_id,
          instance_url,
          scopes_json,
          token_json,
          status,
          is_default,
          connected_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          salesforce_user_id = VALUES(salesforce_user_id),
          username = VALUES(username),
          instance_url = VALUES(instance_url),
          scopes_json = VALUES(scopes_json),
          token_json = VALUES(token_json),
          status = VALUES(status),
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        uuidv4(),
        session.user.id,
        req.body?.salesforceUserId ?? null,
        req.body?.username ?? null,
        orgId,
        req.body?.instanceUrl ?? null,
        JSON.stringify(scopes),
        req.body?.token ? JSON.stringify(req.body.token) : null,
        status,
        shouldSetDefault ? 1 : 0,
      ]
    );

    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Salesforce connect error';
    return res.status(500).json({ error: `Failed to store Salesforce account: ${message}` });
  }
});

app.post('/api/integrations/salesforce/disconnect', async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized session' });
  }

  if (!dbPool) {
    return res.status(503).json({ error: 'Database is not configured' });
  }

  try {
    const accountId = req.body?.accountId;
    if (accountId && typeof accountId === 'string') {
      await dbPool.query(
        `
          UPDATE salesforce_accounts
          SET status = 'disconnected', token_json = NULL, is_default = 0, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND id = ?
        `,
        [session.user.id, accountId]
      );
    } else {
      await dbPool.query(
        `
          UPDATE salesforce_accounts
          SET status = 'disconnected', token_json = NULL, is_default = 0, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?
        `,
        [session.user.id]
      );
    }

    const [firstConnected] = await dbPool.query(
      `
        SELECT id
        FROM salesforce_accounts
        WHERE user_id = ? AND status = 'connected'
        ORDER BY connected_at ASC
        LIMIT 1
      `,
      [session.user.id]
    );

    if (firstConnected?.[0]?.id) {
      await dbPool.query(
        'UPDATE salesforce_accounts SET is_default = 1 WHERE id = ? AND user_id = ?',
        [firstConnected[0].id, session.user.id]
      );
    }

    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Salesforce disconnect error';
    return res.status(500).json({ error: `Failed to disconnect Salesforce account: ${message}` });
  }
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
    claude: {
      status: process.env.ANTHROPIC_API_KEY ? 'connected' : 'disconnected',
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    },
    slack: slackAccount
      ? {
          status: 'connected',
          available: true,
          teamName: slackAccount.teamName,
          authedUserId: slackAccount.userId,
          scopes: slackAccount.scopes,
          connectedAt: slackAccount.connectedAt,
        }
      : { status: 'disconnected', available: !!process.env.SLACK_CLIENT_ID },
    // Not yet wired server-side.
    clickup: { status: 'disconnected', available: false },
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

app.get('/api/email/poll', async (req, res) => {
  const sessionId = req.query.sessionId;
  const session = getSessionById(sessionId);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized session' });
  }

  const defaultAccount = getDefaultGmailAccount();
  if (!defaultAccount) {
    return res.json({ emails: [] });
  }

  if (!isAllowedDomain(defaultAccount.accountEmail)) {
    return res.status(403).json({ error: 'Default Gmail account domain is not authorized' });
  }

  const token = defaultAccount.token ?? session.tokens ?? null;
  if (!token) {
    return res.json({ emails: [] });
  }

  try {
    const oauth2Client = getOAuthClient();
    if (!oauth2Client) {
      return res.status(400).json({ error: 'Missing OAuth env vars.' });
    }
    oauth2Client.setCredentials(token);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:inbox -category:promotions -category:social newer_than:7d',
      maxResults: 10,
    });

    const messageMetas = listResponse.data.messages ?? [];
    const seen = seenMessageIdsByAccount.get(defaultAccount.accountEmail) ?? new Set();
    const newEmails = [];

    for (const meta of messageMetas) {
      if (!meta.id || seen.has(meta.id)) continue;

      const msgResponse = await gmail.users.messages.get({
        userId: 'me',
        id: meta.id,
        format: 'full',
      });
      const msg = msgResponse.data;
      const headers = msg.payload?.headers ?? [];

      const from = getHeaderValue(headers, 'From');
      const subject = getHeaderValue(headers, 'Subject') || '(No subject)';
      const dateHeader = getHeaderValue(headers, 'Date');
      const body = extractTextBody(msg.payload).trim();

      newEmails.push({
        messageId: msg.id,
        threadId: msg.threadId,
        from,
        subject,
        snippet: msg.snippet ?? '',
        body,
        date: dateHeader || (msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString()),
      });

      seen.add(meta.id);
    }

    seenMessageIdsByAccount.set(defaultAccount.accountEmail, seen);
    return res.json({ emails: newEmails });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown poll error';
    console.error(`[Email Poll] Error: ${message}`);
    return res.status(500).json({ error: `Failed to poll email: ${message}` });
  }
});

// ── Slack OAuth (user token: read + send as the user) ──────────────────────────

function getSlackRedirectUri() {
  return process.env.SLACK_REDIRECT_URI || `http://localhost:${PORT}/api/integrations/slack/callback`;
}

app.get('/api/integrations/slack/connect', (_req, res) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return res.status(400).json({ error: 'SLACK_CLIENT_ID is not set on the server.' });
  }
  const authUrl =
    `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&user_scope=${encodeURIComponent(SLACK_USER_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(getSlackRedirectUri())}` +
    `&state=slack_connect`;
  res.json({ authUrl });
});

app.get('/api/integrations/slack/callback', async (req, res) => {
  const code = req.query.code;
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!code || !clientId || !clientSecret) {
    return res.status(400).send('Slack OAuth is not configured, or the code is missing.');
  }
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: String(code),
      redirect_uri: getSlackRedirectUri(),
    });
    const r = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await r.json();
    if (!data.ok) {
      console.error(`[Slack OAuth] Error: ${data.error}`);
      return res.status(400).send(`Slack OAuth failed: ${data.error}`);
    }
    slackAccount = {
      teamId: data.team?.id ?? null,
      teamName: data.team?.name ?? null,
      userId: data.authed_user?.id ?? null,
      accessToken: data.authed_user?.access_token ?? null,
      scopes: (data.authed_user?.scope ?? '').split(',').filter(Boolean),
      connectedAt: new Date().toISOString(),
    };
    console.log(`[Slack OAuth] Connected team "${slackAccount.teamName}" (user ${slackAccount.userId})`);
    return res.redirect(`${FRONTEND_URL}?slack=connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Slack OAuth error';
    console.error(`[Slack OAuth] Error: ${message}`);
    return res.status(500).send(`Slack OAuth failed: ${message}`);
  }
});

app.post('/api/integrations/slack/disconnect', (_req, res) => {
  slackAccount = null;
  res.json({ ok: true });
});

// Draft an email reply in the user's voice via Claude.
app.post('/api/email/draft', async (req, res) => {
  const sessionId = req.query.sessionId || req.body?.sessionId;
  const session = getSessionById(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized session' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' });
  }

  const { messages = [], subject = '', voiceInstructions = '' } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No email thread to draft from.' });
  }

  const threadText = messages
    .map((m) => `From: ${m.from || 'unknown'}\n${m.body || ''}`)
    .join('\n\n---\n\n');

  const userName = session.user?.name || 'the user';
  const system =
    `You draft email replies on behalf of ${userName}. Write a ready-to-send reply in their voice.` +
    (voiceInstructions ? `\n\nVoice & style guidance:\n${voiceInstructions}` : '') +
    `\n\nReturn ONLY the reply body — no subject line, no "Here is a draft", no surrounding quotes.`;

  const userMsg =
    `Subject: ${subject}\n\nEmail thread (most recent message last):\n\n${threadText}\n\n` +
    `Draft ${userName}'s reply.`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      console.error(`[Email Draft] Claude error ${claudeRes.status}: ${text.slice(0, 300)}`);
      return res.status(502).json({ error: `Claude error: ${claudeRes.status}` });
    }

    const data = await claudeRes.json();
    const draft = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return res.json({ draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown draft error';
    console.error(`[Email Draft] Error: ${message}`);
    return res.status(500).json({ error: `Failed to draft reply: ${message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Relay API listening on http://localhost:${PORT}`);
  console.log(`[Config] Allowed domains: ${ALLOWED_DOMAINS.join(', ')}`);
  console.log(`[Config] Allowed origins: ${allowedOrigins.join(', ')}`);
});
