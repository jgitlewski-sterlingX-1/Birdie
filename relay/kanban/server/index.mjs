import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import mysql from 'mysql2/promise';
import { ensureCoreSchema } from './init-db.mjs';

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
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // sessions stay valid for a full day
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'];
// User-token scopes: read + send as the user (mirrors the email flow).
const SLACK_USER_SCOPES = 'channels:history,channels:read,groups:history,im:history,chat:write,users:read,search:read';
const AUTH_SCOPES = ['openid', 'email', 'profile', ...GMAIL_SCOPES];

const gmailAccounts = [];
let defaultGmailAccountEmail = null;
// In-memory Slack connection (single workspace, like gmailAccounts).
let slackAccount = null;

// ── Feature flags + roles ──────────────────────────────────────────────────────
// Stored in MySQL when available; falls back to in-memory defaults otherwise
// (e.g. local dev with the DB off). Admins are bootstrapped via ADMIN_EMAILS.
// Seed super-admin is always an admin (so the flag panel is reachable in prod
// even before ADMIN_EMAILS is set on the server), plus any ADMIN_EMAILS entries.
const BOOTSTRAP_ADMIN_EMAILS = ['jgitlewski@rocketclicks.com'];
const ADMIN_EMAILS = [
  ...new Set([
    ...(process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    ...BOOTSTRAP_ADMIN_EMAILS,
  ]),
];

const DEFAULT_ROLES = [
  { name: 'admin', description: 'Full access, manages flags and roles' },
  { name: 'member', description: 'Standard user' },
];

// One flag per shippable feature. enabled=false is a kill switch; an empty
// allowedRoles means "everyone" (when enabled).
const DEFAULT_FLAGS = [
  { key: 'slack_integration', name: 'Slack integration', description: 'Connect Slack and triage messages.', enabled: true, allowedRoles: ['admin'] },
  { key: 'voice_drafting', name: 'Voice reply drafting', description: 'Auto-draft email replies in the user\'s voice. Requires ANTHROPIC_API_KEY — keep OFF until that is set, then enable here.', enabled: false, allowedRoles: ['admin', 'member'] },
  { key: 'card_delegation', name: 'Card delegation', description: 'Assign cards to others with action items.', enabled: true, allowedRoles: ['admin', 'member'] },
  { key: 'project_create', name: 'Create project from card', description: 'Create a project inline on a card.', enabled: true, allowedRoles: ['admin', 'member'] },
  { key: 'integrations_tiles', name: 'Integrations tiles', description: 'Connected-apps tiles in Settings.', enabled: true, allowedRoles: ['admin', 'member'] },
];

let memFlags = DEFAULT_FLAGS.map((f) => ({ ...f, allowedRoles: [...f.allowedRoles] }));
let memRoles = DEFAULT_ROLES.map((r) => ({ ...r }));
const memUserRoles = new Map(); // userId -> string[]
const memLockedUsers = new Set(); // userIds locked (in-memory fallback)
const memConnections = new Map(); // `${userId}:${provider}` -> connection (in-memory fallback)

// ── Per-user integration connections ────────────────────────────────────────
// One connection per (user, provider). secret holds the API key / OAuth token.
async function getConnection(userId, provider) {
  if (!userId) return null;
  if (!dbPool) return memConnections.get(`${userId}:${provider}`) ?? null;
  try {
    const [rows] = await dbPool.query(
      'SELECT provider, status, account_label, secret_json, scopes_json FROM integration_connections WHERE user_id = ? AND provider = ? LIMIT 1',
      [userId, provider]
    );
    const r = rows?.[0];
    if (!r) return null;
    return {
      provider: r.provider,
      status: r.status,
      accountLabel: r.account_label,
      secret: r.secret_json ? JSON.parse(r.secret_json) : null,
      scopes: r.scopes_json ? JSON.parse(r.scopes_json) : [],
    };
  } catch (e) {
    console.error(`[Integrations] getConnection failed: ${e.message}`);
    return null;
  }
}

async function setConnection(userId, provider, { accountLabel = null, secret = null, scopes = [] }) {
  if (!dbPool) {
    memConnections.set(`${userId}:${provider}`, { provider, status: 'connected', accountLabel, secret, scopes });
    return;
  }
  await dbPool.query(
    `INSERT INTO integration_connections (user_id, provider, status, account_label, secret_json, scopes_json)
     VALUES (?, ?, 'connected', ?, ?, ?)
     ON DUPLICATE KEY UPDATE status='connected', account_label=VALUES(account_label), secret_json=VALUES(secret_json), scopes_json=VALUES(scopes_json)`,
    [userId, provider, accountLabel, JSON.stringify(secret ?? null), JSON.stringify(scopes ?? [])]
  );
}

async function deleteConnection(userId, provider) {
  if (!dbPool) {
    memConnections.delete(`${userId}:${provider}`);
    return;
  }
  await dbPool.query('DELETE FROM integration_connections WHERE user_id = ? AND provider = ?', [userId, provider]);
}

async function initFlagSchema() {
  if (!dbPool) return;
  await dbPool.query(`CREATE TABLE IF NOT EXISTS feature_flags (
    flag_key VARCHAR(128) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    allowed_roles TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await dbPool.query(`CREATE TABLE IF NOT EXISTS roles (
    name VARCHAR(64) PRIMARY KEY,
    description VARCHAR(255)
  )`);
  await dbPool.query(`CREATE TABLE IF NOT EXISTS user_roles (
    user_id VARCHAR(64) NOT NULL,
    role VARCHAR(64) NOT NULL,
    PRIMARY KEY (user_id, role)
  )`);
  // Seed defaults only if empty.
  const [[{ c: flagCount }]] = await dbPool.query('SELECT COUNT(*) AS c FROM feature_flags');
  if (flagCount === 0) {
    for (const f of DEFAULT_FLAGS) {
      await dbPool.query(
        'INSERT INTO feature_flags (flag_key, name, description, enabled, allowed_roles) VALUES (?, ?, ?, ?, ?)',
        [f.key, f.name, f.description, f.enabled ? 1 : 0, JSON.stringify(f.allowedRoles)]
      );
    }
  }
  const [[{ c: roleCount }]] = await dbPool.query('SELECT COUNT(*) AS c FROM roles');
  if (roleCount === 0) {
    for (const r of DEFAULT_ROLES) {
      await dbPool.query('INSERT INTO roles (name, description) VALUES (?, ?)', [r.name, r.description]);
    }
  }
}

async function getAllFlags() {
  if (!dbPool) return memFlags.map((f) => ({ ...f, allowedRoles: [...f.allowedRoles] }));
  const [rows] = await dbPool.query('SELECT flag_key, name, description, enabled, allowed_roles FROM feature_flags ORDER BY flag_key');
  return rows.map((r) => ({
    key: r.flag_key,
    name: r.name,
    description: r.description,
    enabled: !!r.enabled,
    allowedRoles: JSON.parse(r.allowed_roles || '[]'),
  }));
}

async function upsertFlag(flag) {
  if (!dbPool) {
    const i = memFlags.findIndex((f) => f.key === flag.key);
    const next = { key: flag.key, name: flag.name, description: flag.description ?? '', enabled: !!flag.enabled, allowedRoles: flag.allowedRoles ?? [] };
    if (i >= 0) memFlags[i] = next; else memFlags.push(next);
    return next;
  }
  await dbPool.query(
    `INSERT INTO feature_flags (flag_key, name, description, enabled, allowed_roles)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description), enabled=VALUES(enabled), allowed_roles=VALUES(allowed_roles)`,
    [flag.key, flag.name, flag.description ?? '', flag.enabled ? 1 : 0, JSON.stringify(flag.allowedRoles ?? [])]
  );
  return flag;
}

async function getRoles() {
  if (!dbPool) return memRoles.map((r) => ({ ...r }));
  const [rows] = await dbPool.query('SELECT name, description FROM roles ORDER BY name');
  return rows;
}

async function createRole(name, description) {
  if (!dbPool) {
    if (!memRoles.some((r) => r.name === name)) memRoles.push({ name, description: description ?? '' });
    return;
  }
  await dbPool.query('INSERT IGNORE INTO roles (name, description) VALUES (?, ?)', [name, description ?? '']);
}

async function getUserRoles(userId) {
  if (!dbPool) return memUserRoles.get(userId) ?? [];
  const [rows] = await dbPool.query('SELECT role FROM user_roles WHERE user_id = ?', [userId]);
  return rows.map((r) => r.role);
}

async function setUserRoles(userId, roles) {
  if (!dbPool) {
    memUserRoles.set(userId, [...roles]);
    return;
  }
  await dbPool.query('DELETE FROM user_roles WHERE user_id = ?', [userId]);
  for (const role of roles) {
    await dbPool.query('INSERT IGNORE INTO user_roles (user_id, role) VALUES (?, ?)', [userId, role]);
  }
}

// On login: give a new user the default 'member' role, and the 'admin' role if
// their email is a configured/seed admin (so admins can manage feature flags).
async function ensureUserRoles(userId, email) {
  const existing = await getUserRoles(userId);
  const roles = new Set(existing);
  if (roles.size === 0) roles.add('member');
  if (ADMIN_EMAILS.includes((email || '').toLowerCase())) roles.add('admin');
  if (roles.size !== existing.length) {
    await setUserRoles(userId, [...roles]);
  }
}

async function listKnownUsers() {
  if (dbPool) {
    const [rows] = await dbPool.query(
      'SELECT id, email, name, domain, created_at, last_login_at, locked FROM users ORDER BY email'
    );
    return rows.map((r) => ({
      id: String(r.id),
      email: r.email,
      name: r.name,
      domain: r.domain,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
      locked: !!r.locked,
    }));
  }
  // In-memory fallback: derive from active sessions (no persisted history).
  const byId = new Map();
  for (const s of sessions.values()) {
    if (s.user?.id)
      byId.set(String(s.user.id), {
        id: String(s.user.id),
        email: s.user.email,
        name: s.user.name,
        domain: s.user.domain ?? null,
        createdAt: null,
        lastLoginAt: null,
        locked: memLockedUsers.has(String(s.user.id)),
      });
  }
  return Array.from(byId.values());
}

function isAdminSession(session) {
  if (!session?.user) return false;
  if (ADMIN_EMAILS.includes((session.user.email || '').toLowerCase())) return true;
  return false; // role-based admin is layered in at evaluation time
}

async function effectiveRoles(session) {
  const roles = new Set(await getUserRoles(session.user.id));
  if (isAdminSession(session)) roles.add('admin');
  return roles;
}

async function evaluateFlagsForUser(session) {
  const roles = await effectiveRoles(session);
  const isAdmin = roles.has('admin');
  const flags = await getAllFlags();
  const evaluated = {};
  for (const f of flags) {
    const allowedByRole = f.allowedRoles.length === 0 || isAdmin || f.allowedRoles.some((r) => roles.has(r));
    evaluated[f.key] = f.enabled && allowedByRole;
  }
  return { flags: evaluated, roles: Array.from(roles), isAdmin };
}

// Resolve a session and require admin; returns the session or sends 401/403.
async function requireAdmin(req, res) {
  const sessionId = req.query.sessionId || req.body?.sessionId;
  const session = getSessionById(sessionId);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized session' });
    return null;
  }
  const roles = await effectiveRoles(session);
  if (!roles.has('admin')) {
    res.status(403).json({ error: 'Admin role required' });
    return null;
  }
  return session;
}
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
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt && session.expiresAt < Date.now()) {
    void deleteSession(sessionId);
    return null;
  }
  return session;
}

// Persist a session so it survives API restarts (every deploy restarts pm2) for
// its full-day TTL; rehydrated on boot via loadSessionsFromDb.
async function persistSession(session) {
  if (!dbPool) return;
  try {
    await dbPool.query(
      `INSERT INTO sessions (id, user_id, email, name, domain, tokens_json, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))
       ON DUPLICATE KEY UPDATE tokens_json = VALUES(tokens_json), expires_at = VALUES(expires_at)`,
      [
        session.id,
        session.user.id,
        session.user.email,
        session.user.name,
        session.user.domain,
        JSON.stringify(session.tokens ?? null),
      ]
    );
  } catch (e) {
    console.error(`[Session] persist failed: ${e.message}`);
  }
}

async function loadSessionsFromDb() {
  if (!dbPool) return;
  try {
    const [rows] = await dbPool.query(
      'SELECT id, user_id, email, name, domain, tokens_json, created_at, expires_at FROM sessions WHERE expires_at > NOW()'
    );
    for (const r of rows) {
      const tokens = r.tokens_json ? JSON.parse(r.tokens_json) : null;
      sessions.set(r.id, {
        id: r.id,
        user: { id: r.user_id, email: r.email, name: r.name, domain: r.domain },
        createdAt: r.created_at,
        tokens,
        expiresAt: new Date(r.expires_at).getTime(),
      });
      // Rebuild the in-memory Gmail connection from the persisted session token
      // so email sync and the Gmail tile survive restarts/deploys (the login
      // account's token IS the session token, with gmail scopes).
      if (tokens) {
        upsertGmailAccount({
          accountEmail: r.email,
          userDomain: r.domain,
          scopes: AUTH_SCOPES,
          token: tokens,
          source: 'auth-login',
          setAsDefault: !defaultGmailAccountEmail,
        });
      }
    }
    console.log(`[Session] Rehydrated ${rows.length} active session(s)`);
  } catch (e) {
    console.error(`[Session] load failed: ${e.message}`);
  }
}

async function deleteSession(sessionId) {
  sessions.delete(sessionId);
  if (dbPool) {
    try {
      await dbPool.query('DELETE FROM sessions WHERE id = ?', [sessionId]);
    } catch {
      /* best effort */
    }
  }
}

// Invalidate all of a user's sessions (used when locking an account).
async function deleteUserSessions(userId) {
  for (const [id, s] of sessions) {
    if (s.user?.id === userId) sessions.delete(id);
  }
  if (dbPool) {
    try {
      await dbPool.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
    } catch {
      /* best effort */
    }
  }
}

async function isUserLocked(userId) {
  if (!dbPool) return memLockedUsers.has(userId);
  try {
    const [rows] = await dbPool.query('SELECT locked FROM users WHERE id = ? LIMIT 1', [userId]);
    return !!rows?.[0]?.locked;
  } catch {
    return false;
  }
}

// Lock/unlock an account. Locking also kills the user's active sessions so they
// are logged out immediately and can't re-login (blocked in the auth callback).
async function setUserLocked(userId, locked) {
  if (!dbPool) {
    if (locked) memLockedUsers.add(userId);
    else memLockedUsers.delete(userId);
  } else {
    await dbPool.query('UPDATE users SET locked = ? WHERE id = ?', [locked ? 1 : 0, userId]);
  }
  if (locked) await deleteUserSessions(userId);
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

    // First login → ensure the user has at least the default 'member' role.
    // Locked accounts cannot sign in.
    if (await isUserLocked(appUser.id)) {
      console.warn(`[Auth] Locked account login blocked: ${email}`);
      return res.status(403).send('Your account has been locked. Contact an administrator.');
    }

    try {
      await ensureUserRoles(appUser.id, appUser.email);
    } catch (roleErr) {
      console.error(`[Auth] ensureUserRoles failed: ${roleErr.message}`);
    }

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
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    sessions.set(sessionId, session);
    void persistSession(session);

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

  const session = getSessionById(sessionId);
  if (!session) {
    return res.json({ authenticated: false, user: null });
  }

  res.json({ authenticated: true, sessionId, user: session.user });
});

app.post('/api/auth/logout', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) {
    void deleteSession(sessionId);
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
app.get('/api/integrations', async (req, res) => {
  const session = getSessionById(req.query.sessionId);
  const claudeConn = session ? await getConnection(session.user.id, 'claude') : null;
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
      status: claudeConn ? 'connected' : 'disconnected',
      accountLabel: claudeConn?.accountLabel ?? null,
      platformKeyAvailable: !!process.env.ANTHROPIC_API_KEY,
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

// Slack Web API helper (GET with the user's bearer token).
async function slackApi(method, token, params = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return r.json();
}

const seenSlackKeys = new Set();

// Poll Slack for recent messages that mention the user — the triage source for
// Slack cards (the analog of the Gmail inbox poll). Uses search.messages so it
// needs only search:read + users:read.
app.get('/api/slack/poll', async (req, res) => {
  const session = getSessionById(req.query.sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });
  if (!slackAccount?.accessToken) return res.json({ messages: [] });

  const token = slackAccount.accessToken;
  try {
    if (!slackAccount.handle && slackAccount.userId) {
      const info = await slackApi('users.info', token, { user: slackAccount.userId });
      slackAccount.handle = info.ok
        ? info.user?.profile?.display_name || info.user?.name || null
        : null;
    }
    const handle = slackAccount.handle;
    if (!handle) return res.json({ messages: [] });

    const search = await slackApi('search.messages', token, {
      query: handle,
      sort: 'timestamp',
      count: 20,
    });
    if (!search.ok) {
      console.error(`[Slack poll] ${search.error}`);
      return res.status(502).json({ error: `Slack: ${search.error}` });
    }

    const matches = search.messages?.matches ?? [];
    const nameCache = new Map();
    const out = [];
    for (const m of matches) {
      const key = `${m.channel?.id ?? '?'}:${m.ts}`;
      if (seenSlackKeys.has(key)) continue;
      seenSlackKeys.add(key);

      let from = m.username || m.user || 'unknown';
      if (m.user) {
        if (!nameCache.has(m.user)) {
          const ui = await slackApi('users.info', token, { user: m.user });
          nameCache.set(m.user, ui.ok ? ui.user?.real_name || ui.user?.name || m.user : m.user);
        }
        from = nameCache.get(m.user);
      }

      out.push({
        messageId: key,
        channelId: m.channel?.id ?? null,
        channelName: m.channel?.name ?? null,
        from,
        text: m.text || '',
        ts: m.ts,
        permalink: m.permalink ?? null,
      });
    }
    return res.json({ messages: out });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Slack poll error';
    console.error(`[Slack poll] Error: ${message}`);
    return res.status(500).json({ error: `Failed to poll Slack: ${message}` });
  }
});

// Claude has no OAuth — each user stores their own Anthropic API key.
app.post('/api/integrations/claude/connect', async (req, res) => {
  const session = getSessionById(req.query.sessionId || req.body?.sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });
  const apiKey = (req.body?.apiKey || '').trim();
  if (!apiKey.startsWith('sk-ant-')) {
    return res.status(400).json({ error: 'That does not look like an Anthropic API key (expected sk-ant-…).' });
  }
  const accountLabel = `sk-ant-…${apiKey.slice(-4)}`;
  await setConnection(session.user.id, 'claude', { accountLabel, secret: apiKey });
  res.json({ ok: true, accountLabel });
});

app.post('/api/integrations/claude/disconnect', async (req, res) => {
  const session = getSessionById(req.query.sessionId || req.body?.sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });
  await deleteConnection(session.user.id, 'claude');
  res.json({ ok: true });
});

// Draft an email reply in the user's voice via Claude (per-user key, else platform).
app.post('/api/email/draft', async (req, res) => {
  const sessionId = req.query.sessionId || req.body?.sessionId;
  const session = getSessionById(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized session' });
  }

  const conn = await getConnection(session.user.id, 'claude');
  const apiKey = (conn && conn.secret) || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'No Claude key. Connect Claude in Settings → Integrations.' });
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

// ── Feature flag endpoints ──────────────────────────────────────────────────

// Flags evaluated for the calling user (drives client gating).
app.get('/api/flags', async (req, res) => {
  const session = getSessionById(req.query.sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });
  try {
    res.json(await evaluateFlagsForUser(session));
  } catch (error) {
    res.status(500).json({ error: `Failed to evaluate flags: ${error.message}` });
  }
});

// Admin: full flag definitions.
app.get('/api/admin/flags', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json({ flags: await getAllFlags() });
});

// Admin: create or update a flag.
app.put('/api/admin/flags/:key', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { name, description, enabled, allowedRoles } = req.body ?? {};
  await upsertFlag({
    key: req.params.key,
    name: name ?? req.params.key,
    description: description ?? '',
    enabled: !!enabled,
    allowedRoles: Array.isArray(allowedRoles) ? allowedRoles : [],
  });
  res.json({ ok: true });
});

// Admin: roles.
app.get('/api/admin/roles', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json({ roles: await getRoles() });
});

app.post('/api/admin/roles', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { name, description } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'Role name is required' });
  await createRole(name, description);
  res.json({ ok: true });
});

// Admin: users + their roles.
app.get('/api/admin/users', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const users = await listKnownUsers();
  const withRoles = await Promise.all(
    users.map(async (u) => ({ ...u, roles: await getUserRoles(u.id) }))
  );
  res.json({ users: withRoles });
});

app.put('/api/admin/users/:id/roles', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { roles } = req.body ?? {};
  await setUserRoles(req.params.id, Array.isArray(roles) ? roles : []);
  res.json({ ok: true });
});

// Admin: lock / unlock a user account (locking logs them out + blocks re-login).
app.put('/api/admin/users/:id/lock', async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;
  const locked = !!req.body?.locked;
  const targetId = req.params.id;

  if (targetId === session.user.id) {
    return res.status(400).json({ error: 'You cannot lock your own account.' });
  }
  if (locked && dbPool) {
    const [rows] = await dbPool.query('SELECT email FROM users WHERE id = ? LIMIT 1', [targetId]);
    const targetEmail = rows?.[0]?.email ?? null;
    if (targetEmail && ADMIN_EMAILS.includes(targetEmail.toLowerCase())) {
      return res.status(400).json({ error: 'Cannot lock a configured admin account.' });
    }
  }
  await setUserLocked(targetId, locked);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  if (dbPool) {
    // Core app schema (users, sessions, gmail_accounts, …) then flags/roles.
    // Both idempotent; runs every boot so the DB can't be half-migrated.
    ensureCoreSchema(dbPool)
      .then(() => initFlagSchema())
      .then(() => loadSessionsFromDb())
      .catch((e) => console.error(`[DB] Schema init failed: ${e.message}`));
  }
  console.log(`Relay API listening on http://localhost:${PORT}`);
  console.log(`[Config] Allowed domains: ${ALLOWED_DOMAINS.join(', ')}`);
  console.log(`[Config] Allowed origins: ${allowedOrigins.join(', ')}`);
});
