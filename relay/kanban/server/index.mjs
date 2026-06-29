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
const DIRECTORY_SCOPE = 'https://www.googleapis.com/auth/directory.readonly';
// User-token scopes: read + send as the user (mirrors the email flow).
const SLACK_USER_SCOPES = 'channels:history,channels:read,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,chat:write,users:read,users.profile:read,search:read';
const AUTH_SCOPES = ['openid', 'email', 'profile', DIRECTORY_SCOPE, ...GMAIL_SCOPES];

// Domain-level directory cache — keyed by domain, TTL 10 min. Shared across
// all users on the same domain since the org directory is the same for everyone.
const directoryCache = new Map(); // domain → { users, expiresAt }
const DIRECTORY_CACHE_TTL_MS = 10 * 60 * 1000;

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

// Sentinel userId for the platform-level Claude key. Stored the same way as a
// user key so it survives restarts via the DB, but is shared across all users.
const PLATFORM_USER_ID = '__platform__';

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

// Resolve the Claude API key for a given user. Priority:
//   1. The user's own stored key
//   2. The platform key (written when any user connects a key)
//   3. ANTHROPIC_API_KEY env var (last resort — not user-managed)
async function resolveClaudeKey(userId) {
  if (userId) {
    const userConn = await getConnection(userId, 'claude');
    if (userConn?.secret) return userConn.secret;
  }
  const platformConn = await getConnection(PLATFORM_USER_ID, 'claude');
  if (platformConn?.secret) return platformConn.secret;
  return process.env.ANTHROPIC_API_KEY ?? null;
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

// Resolve a session (any authenticated user); returns the session or sends 401.
async function requireSession(req, res) {
  const sessionId = req.query.sessionId || req.body?.sessionId;
  const session = getSessionById(sessionId);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized session' });
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

  // Gmail is connected if the in-memory account list has an entry OR if the
  // current session has a token with Gmail scopes (handles multi-instance Cloud
  // Run where another instance processed the login and populated its own memory).
  const sessionEmail = session?.user?.email ?? null;
  const sessionHasGmailToken = !!(session?.tokens);
  const gmailConnected = !!(defaultAccount || sessionHasGmailToken);
  const gmailEmail = defaultAccount?.accountEmail ?? sessionEmail;
  const gmailDomain = defaultAccount?.userDomain ?? session?.user?.domain ?? null;

  // Claude is connected if the user stored their own key OR if a platform-level
  // ANTHROPIC_API_KEY is configured (the triage endpoints fall back to it).
  const claudeConnected = !!(claudeConn || process.env.ANTHROPIC_API_KEY);

  res.json({
    gmail: {
      status: gmailConnected ? 'connected' : 'disconnected',
      accountEmail: gmailEmail,
      userDomain: gmailDomain,
      lastConnectedAt: defaultAccount?.lastConnectedAt ?? null,
      scopes: defaultAccount?.scopes ?? GMAIL_SCOPES,
      defaultAccountEmail: defaultGmailAccountEmail ?? gmailEmail,
      accounts: gmailConnected && gmailAccounts.length === 0 && sessionEmail
        ? [{ accountEmail: sessionEmail, userDomain: gmailDomain, lastConnectedAt: null, scopes: AUTH_SCOPES, source: 'auth-login' }]
        : gmailAccounts.map((account) => ({
            accountEmail: account.accountEmail,
            userDomain: account.userDomain,
            lastConnectedAt: account.lastConnectedAt,
            scopes: account.scopes,
            source: account.source,
          })),
    },
    claude: {
      status: claudeConnected ? 'connected' : 'disconnected',
      accountLabel: claudeConn?.accountLabel ?? (process.env.ANTHROPIC_API_KEY ? 'Platform key' : null),
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
      const to = getHeaderValue(headers, 'To');
      const cc = getHeaderValue(headers, 'Cc');
      const body = extractTextBody(msg.payload).trim();
      const msgDate = dateHeader || (msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString());

      // Fetch the full thread so the triage model sees the entire conversation.
      let emailThread = [{
        from,
        date: msgDate,
        body,
        ...(to ? { to } : {}),
        ...(cc ? { cc } : {}),
      }];
      try {
        const threadRes = await gmail.users.threads.get({
          userId: 'me',
          id: msg.threadId,
          format: 'full',
        });
        const threadMsgs = threadRes.data.messages ?? [];
        if (threadMsgs.length > 1) {
          emailThread = threadMsgs.map((tm) => {
            const th = tm.payload?.headers ?? [];
            const tmFrom = getHeaderValue(th, 'From');
            const tmTo = getHeaderValue(th, 'To');
            const tmCc = getHeaderValue(th, 'Cc');
            const tmDate = getHeaderValue(th, 'Date') || (tm.internalDate ? new Date(Number(tm.internalDate)).toISOString() : '');
            const tmBody = extractTextBody(tm.payload).trim();
            return {
              from: tmFrom,
              date: tmDate,
              body: tmBody,
              ...(tmTo ? { to: tmTo } : {}),
              ...(tmCc ? { cc: tmCc } : {}),
            };
          }).filter((tm) => tm.from || tm.body);
        }
      } catch (threadErr) {
        console.error(`[Email Poll] Thread fetch failed for ${msg.threadId}: ${threadErr instanceof Error ? threadErr.message : threadErr}`);
      }

      newEmails.push({
        messageId: msg.id,
        threadId: msg.threadId,
        from,
        subject,
        snippet: msg.snippet ?? '',
        body,
        date: msgDate,
        ...(to ? { to } : {}),
        ...(cc ? { cc } : {}),
        emailThread,
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

// Mark a Gmail thread as read. Best-effort — always returns { ok: true } to
// the client so a transient failure never blocks the card from opening.
app.post('/api/email/mark-read', async (req, res) => {
  const sessionId = req.body?.sessionId || req.query.sessionId;
  const session = getSessionById(sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const { threadId } = req.body ?? {};
  if (!threadId) return res.status(400).json({ error: 'threadId required' });

  const defaultAccount = getDefaultGmailAccount();
  const token = defaultAccount?.token ?? session.tokens ?? null;
  if (!token) return res.json({ ok: true });

  try {
    const oauth2Client = getOAuthClient();
    if (!oauth2Client) return res.json({ ok: true });
    oauth2Client.setCredentials(token);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    await gmail.users.threads.modify({
      userId: 'me',
      id: threadId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  } catch (error) {
    console.error(`[Mark Read] ${error.message}`);
  }
  return res.json({ ok: true });
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
    // Persist so the token survives Cloud Run restarts
    if (dbPool && slackAccount.teamId && slackAccount.userId && slackAccount.accessToken) {
      try {
        await dbPool.query(
          `INSERT INTO slack_tokens (team_id, team_name, user_id, access_token, scopes)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE team_name=VALUES(team_name), access_token=VALUES(access_token), scopes=VALUES(scopes), connected_at=NOW()`,
          [slackAccount.teamId, slackAccount.teamName, slackAccount.userId, slackAccount.accessToken, slackAccount.scopes.join(',')]
        );
      } catch (e) { console.error(`[Slack OAuth] DB persist failed: ${e.message}`); }
    }
    console.log(`[Slack OAuth] Connected team "${slackAccount.teamName}" (user ${slackAccount.userId})`);
    return res.redirect(`${FRONTEND_URL}?slack=connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Slack OAuth error';
    console.error(`[Slack OAuth] Error: ${message}`);
    return res.status(500).send(`Slack OAuth failed: ${message}`);
  }
});

app.post('/api/integrations/slack/disconnect', async (_req, res) => {
  slackAccount = null;
  if (dbPool) {
    try { await dbPool.query('DELETE FROM slack_tokens'); } catch { /* best effort */ }
  }
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

// ── Slack token persistence ───────────────────────────────────────────────────

async function ensureSlackTokensSchema(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS slack_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      team_id VARCHAR(100) NOT NULL,
      team_name VARCHAR(255),
      user_id VARCHAR(100) NOT NULL,
      access_token TEXT NOT NULL,
      scopes TEXT,
      connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_team_user (team_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function loadSlackAccount(pool) {
  if (!pool) return;
  try {
    const [rows] = await pool.query('SELECT * FROM slack_tokens ORDER BY connected_at DESC LIMIT 1');
    if (rows.length > 0) {
      const row = rows[0];
      slackAccount = {
        teamId: row.team_id,
        teamName: row.team_name,
        userId: row.user_id,
        accessToken: row.access_token,
        scopes: (row.scopes || '').split(',').filter(Boolean),
        connectedAt: row.connected_at instanceof Date ? row.connected_at.toISOString() : String(row.connected_at),
      };
      console.log(`[Slack] Rehydrated token for team "${slackAccount.teamName}" (user ${slackAccount.userId})`);
    }
  } catch (e) {
    console.error(`[Slack] Token load failed: ${e.message}`);
  }
}

// ── Intelligence Agent — Slack contact history endpoints ──────────────────────
// These power the persona-building search: given a contact name, return their
// recent Slack messages so the Intelligence Agent can build a communication profile.

// GET /api/slack/channels — list channels the authed user is a member of.
app.get('/api/slack/channels', async (req, res) => {
  const session = getSessionById(req.query.sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });
  if (!slackAccount?.accessToken) return res.json({ channels: [], status: 'disconnected' });

  try {
    const token = slackAccount.accessToken;
    const result = await slackApi('conversations.list', token, {
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: 200,
    });
    if (!result.ok) return res.status(502).json({ error: result.error });
    const channels = (result.channels ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      isPrivate: c.is_private,
      memberCount: c.num_members,
    }));
    res.json({ channels, teamName: slackAccount.teamName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/slack/contact-profile?name=... — search Slack for messages from/about a contact.
// Used by Intelligence Agent to build a communication persona from Slack history.
app.get('/api/slack/contact-profile', async (req, res) => {
  const session = getSessionById(req.query.sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });
  if (!slackAccount?.accessToken) return res.json({ messages: [], users: [], status: 'disconnected' });

  const contactQuery = req.query.name ? String(req.query.name).trim() : '';
  if (!contactQuery) return res.status(400).json({ error: 'name query param required' });

  const token = slackAccount.accessToken;
  try {
    // 1. Find matching Slack users by real name
    const usersResult = await slackApi('users.list', token, { limit: 200 });
    const matchingUsers = (usersResult.ok ? usersResult.members ?? [] : []).filter((u) => {
      const profile = u.profile ?? {};
      const realName = (profile.real_name || u.real_name || u.name || '').toLowerCase();
      return !u.deleted && !u.is_bot && realName.includes(contactQuery.toLowerCase());
    }).map((u) => ({
      id: u.id,
      name: u.profile?.real_name || u.real_name || u.name,
      email: u.profile?.email ?? null,
      title: u.profile?.title ?? null,
      timezone: u.tz ?? null,
    }));

    // 2. Search messages mentioning or from this contact
    const searchResult = await slackApi('search.messages', token, {
      query: contactQuery,
      sort: 'timestamp',
      sort_dir: 'desc',
      count: 30,
    });
    const messages = (searchResult.ok ? searchResult.messages?.matches ?? [] : []).map((m) => ({
      text: m.text || '',
      from: m.username || m.user || 'unknown',
      channelName: m.channel?.name ?? null,
      ts: m.ts,
      permalink: m.permalink ?? null,
    }));

    res.json({
      query: contactQuery,
      matchingUsers,
      messages,
      teamName: slackAccount.teamName,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/slack/channel-history?channelId=...&limit=50 — get recent messages from a channel.
app.get('/api/slack/channel-history', async (req, res) => {
  const session = getSessionById(req.query.sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });
  if (!slackAccount?.accessToken) return res.json({ messages: [], status: 'disconnected' });

  const channelId = req.query.channelId ? String(req.query.channelId) : null;
  if (!channelId) return res.status(400).json({ error: 'channelId required' });
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  try {
    const result = await slackApi('conversations.history', slackAccount.accessToken, { channel: channelId, limit });
    if (!result.ok) return res.status(502).json({ error: result.error });
    const messages = (result.messages ?? []).map((m) => ({
      text: m.text || '',
      user: m.user || null,
      ts: m.ts,
      threadTs: m.thread_ts ?? null,
      replyCount: m.reply_count ?? 0,
    }));
    res.json({ channelId, messages, hasMore: result.has_more ?? false });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
  // Also write the platform key so all skill calls work for users who haven't
  // connected their own key. This survives restarts via the DB.
  await setConnection(PLATFORM_USER_ID, 'claude', { accountLabel, secret: apiKey });
  res.json({ ok: true, accountLabel });
});

app.post('/api/integrations/claude/disconnect', async (req, res) => {
  const session = getSessionById(req.query.sessionId || req.body?.sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });
  await deleteConnection(session.user.id, 'claude');
  res.json({ ok: true });
});

// ── Claude custom Skills (Anthropic /v1/skills, per-user key) ────────────────
// Skills are workspace-scoped to whatever API key created them, so we always
// use the user's own connected key here (no platform-key fallback) — a skill a
// user builds lands in their own Anthropic workspace. Beta header per the
// Skills API. Create/version uploads are multipart/form-data: a display_title
// field plus one files[] part per file, with the relative path in the filename.
const SKILLS_BETA = 'skills-2025-10-02';

function slugifySkillName(title) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'custom-skill';
}

// Build a SKILL.md from the user's title/description/instructions. Frontmatter
// requires name (slug) + description; the body carries the instructions.
function buildSkillMd({ slug, description, category, instructions }) {
  const desc = String(description || slug).replace(/\s+/g, ' ').trim().slice(0, 1024);
  const front = `---\nname: ${slug}\ndescription: ${desc}\n---\n\n`;
  const body =
    (category ? `Applies to ${category} workflows.\n\n` : '') +
    String(instructions || '').trim() +
    '\n';
  return front + body;
}

async function callAnthropicSkills(apiKey, path, { method = 'GET', formData = null } = {}) {
  // Do NOT set content-type for multipart — fetch adds the boundary itself.
  return fetch(`https://api.anthropic.com/v1/skills${path}`, {
    method,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': SKILLS_BETA,
    },
    body: formData,
  });
}

function mapClaudeSkill(s) {
  return {
    id: s.id,
    displayTitle: s.display_title,
    latestVersion: s.latest_version,
    source: s.source,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    // Filled in by the list endpoint from the latest version's SKILL.md.
    name: '',
    description: '',
  };
}

// The list/get endpoints don't carry the SKILL.md frontmatter; fetch the
// version to get the model-facing name + description for the UI summary.
async function fetchSkillVersionMeta(apiKey, skillId, version) {
  try {
    const r = await callAnthropicSkills(
      apiKey,
      `/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(version)}`
    );
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function claudeKeyForSession(session) {
  return resolveClaudeKey(session?.user?.id ?? null);
}

// List the user's custom skills (filters out Anthropic's pre-built ones).
app.get('/api/skills', async (req, res) => {
  const session = getSessionById(req.query.sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });
  const apiKey = await claudeKeyForSession(session);
  if (!apiKey) return res.json({ skills: [], connected: false });
  try {
    const r = await callAnthropicSkills(apiKey, '');
    if (!r.ok) {
      const t = await r.text();
      console.error(`[Skills] list error ${r.status}: ${t.slice(0, 200)}`);
      return res.status(502).json({ error: `Claude skills error: ${r.status}` });
    }
    const data = await r.json();
    const custom = (data.data ?? []).filter((s) => s.source === 'custom');
    // Enrich each with its latest version's name + description (small N).
    const skills = await Promise.all(
      custom.map(async (s) => {
        const mapped = mapClaudeSkill(s);
        const meta = await fetchSkillVersionMeta(apiKey, s.id, s.latest_version);
        if (meta) {
          mapped.name = meta.name ?? '';
          mapped.description = meta.description ?? '';
        }
        return mapped;
      })
    );
    return res.json({ skills, connected: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown skills error';
    return res.status(500).json({ error: message });
  }
});

// Create a custom skill from a title + instructions (auto-builds SKILL.md).
app.post('/api/skills', async (req, res) => {
  const session = getSessionById(req.query.sessionId || req.body?.sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });
  const apiKey = await claudeKeyForSession(session);
  if (!apiKey) return res.status(400).json({ error: 'Connect Claude in Settings → Integrations first.' });

  const { displayTitle = '', description = '', instructions = '', category = '' } = req.body ?? {};
  if (!displayTitle.trim() || !instructions.trim()) {
    return res.status(400).json({ error: 'Title and instructions are required.' });
  }

  const slug = slugifySkillName(displayTitle);
  const skillMd = buildSkillMd({ slug, description, category, instructions });
  const form = new FormData();
  form.append('display_title', displayTitle.trim().slice(0, 255));
  form.append('files[]', new Blob([skillMd], { type: 'text/markdown' }), `${slug}/SKILL.md`);

  try {
    const r = await callAnthropicSkills(apiKey, '', { method: 'POST', formData: form });
    if (!r.ok) {
      const t = await r.text();
      console.error(`[Skills] create error ${r.status}: ${t.slice(0, 300)}`);
      return res.status(502).json({ error: `Claude skills error: ${r.status} ${t.slice(0, 200)}` });
    }
    const data = await r.json();
    return res.json({ skill: mapClaudeSkill(data) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown skills error';
    return res.status(500).json({ error: message });
  }
});

// Delete a custom skill.
app.delete('/api/skills/:id', async (req, res) => {
  const session = getSessionById(req.query.sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });
  const apiKey = await claudeKeyForSession(session);
  if (!apiKey) return res.status(400).json({ error: 'Connect Claude first.' });
  try {
    const r = await callAnthropicSkills(apiKey, `/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) {
      const t = await r.text();
      console.error(`[Skills] delete error ${r.status}: ${t.slice(0, 200)}`);
      return res.status(502).json({ error: `Claude skills error: ${r.status}` });
    }
    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown skills error';
    return res.status(500).json({ error: message });
  }
});

// Draft an email reply in the user's voice via Claude (per-user key, else platform).
app.post('/api/email/draft', async (req, res) => {
  const sessionId = req.query.sessionId || req.body?.sessionId;
  const session = getSessionById(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized session' });
  }

  const apiKey = await resolveClaudeKey(session.user.id);
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

// ── Email triage ─────────────────────────────────────────────────────────────
// Base email skill: read the full thread, return a structured summary + action
// items. Called async after a card is created so the UI shows a placeholder
// immediately and updates when the result arrives.

app.post('/api/email/triage', async (req, res) => {
  const sessionId = req.query.sessionId || req.body?.sessionId;
  const session = getSessionById(sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });

  const apiKey = await resolveClaudeKey(session.user.id);
  if (!apiKey) {
    return res.status(400).json({ error: 'No Claude key. Connect Claude in Settings → Integrations.' });
  }

  const { messages = [], subject = '' } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No email thread provided.' });
  }

  const threadText = messages
    .map((m, i) => {
      const header = [
        `[Message ${i + 1}]`,
        `From: ${m.from || 'unknown'}`,
        m.to ? `To: ${m.to}` : null,
        m.cc ? `Cc: ${m.cc}` : null,
        `Date: ${m.date || ''}`,
      ].filter(Boolean).join('\n');
      return `${header}\n\n${m.body || '(no body)'}`;
    })
    .join('\n\n---\n\n');

  const system =
    `You are an email triage assistant for a busy law firm attorney. Analyze the full email thread and respond with ONLY valid JSON matching this exact shape:
{
  "summary": "...",
  "todos": ["action item 1", "action item 2"]
}

Summary requirements:
- Be comprehensive — cover everything that matters in the thread, using as much space as needed
- Identify all parties, their roles, and their relationship to the firm
- Describe what was asked or raised in each message, what was agreed or disputed, any blockers or open questions, and the current status
- Include every deadline, dollar amount, case name, document reference, or specific fact mentioned
- Note whether this is a new inquiry or part of an ongoing matter
- Write for an attorney who has not read any of these emails — leave nothing important out
- Never start with "This email thread" or similar filler phrases

Todos:
- List every concrete action the attorney must take — do not omit any
- Include deadlines in the action item text if mentioned
- Order by urgency

Return ONLY the JSON object. No markdown fences, no extra explanation.`;

  const userMsg = `Subject: ${subject}\n\nFull email thread (${messages.length} message${messages.length === 1 ? '' : 's'}, oldest first):\n\n${threadText}`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      console.error(`[Email Triage] Claude error ${claudeRes.status}: ${text.slice(0, 300)}`);
      return res.status(502).json({ error: `Claude error: ${claudeRes.status}` });
    }

    const data = await claudeRes.json();
    const raw = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Model returned prose — wrap it
      parsed = { summary: raw, todos: [] };
    }

    return res.json({
      summary: parsed.summary ?? '',
      todoTitles: Array.isArray(parsed.todos) ? parsed.todos : [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown triage error';
    console.error(`[Email Triage] Error: ${message}`);
    return res.status(500).json({ error: `Triage failed: ${message}` });
  }
});

// ── Google Workspace directory ──────────────────────────────────────────────

// Deterministic avatar colour from an email string — same colour every time,
// stable across deploys, no storage needed.
const AVATAR_PALETTE = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#14b8a6','#ec4899','#84cc16'];
function avatarColorFromEmail(email) {
  let h = 0;
  for (const c of (email || '')) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

// Returns org users from the Google Workspace directory. Uses the logged-in
// user's OAuth token (directory.readonly scope). Results are cached per domain
// for 10 min — the same domain always sees the same snapshot.
// Returns { users: [...], needsReauth: bool } — needsReauth=true when the
// stored token pre-dates the directory.readonly scope being added (token has
// no directory permission). The client falls back to hardcoded users silently.
app.get('/api/directory/users', async (req, res) => {
  const session = getSessionById(req.query.sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });

  const domain = session.user.domain;
  if (!domain) return res.json({ users: [], needsReauth: false });

  // Return cached result if still fresh
  const cached = directoryCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ users: cached.users, needsReauth: false });
  }

  const token = session.tokens;
  if (!token) return res.json({ users: [], needsReauth: true });

  // Check whether the token actually carries the directory scope. If not, the
  // People API call would 403 — tell the client to prompt re-auth instead.
  const grantedScopes = token.scope ? token.scope.split(' ') : [];
  if (!grantedScopes.includes(DIRECTORY_SCOPE)) {
    return res.json({ users: [], needsReauth: true });
  }

  const oauth2Client = getOAuthClient();
  if (!oauth2Client) return res.json({ users: [], needsReauth: false });
  oauth2Client.setCredentials(token);

  try {
    const people = google.people({ version: 'v1', auth: oauth2Client });
    const allPeople = [];
    let pageToken;
    do {
      const response = await people.people.listDirectoryPeople({
        readMask: 'names,emailAddresses',
        sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'],
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      });
      const persons = response.data.people ?? [];
      allPeople.push(...persons);
      pageToken = response.data.nextPageToken ?? null;
    } while (pageToken);

    const users = allPeople
      .map((p) => {
        const email = (p.emailAddresses ?? []).find((e) => e.metadata?.primary)?.value
          ?? p.emailAddresses?.[0]?.value ?? '';
        if (!email) return null;
        // Filter to the allowed domain only — never return external contacts
        const emailDomain = email.split('@')[1]?.toLowerCase();
        if (!emailDomain || !ALLOWED_DOMAINS.includes(emailDomain)) return null;
        const name = (p.names ?? []).find((n) => n.metadata?.primary)?.displayName
          ?? p.names?.[0]?.displayName
          ?? email.split('@')[0];
        return {
          id: p.resourceName ?? `dir-${email}`,
          email: email.toLowerCase(),
          name,
          avatarColor: avatarColorFromEmail(email),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    directoryCache.set(domain, { users, expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS });
    return res.json({ users, needsReauth: false });
  } catch (error) {
    const status = error?.response?.status ?? error?.status ?? 0;
    if (status === 403 || status === 401) {
      // Token lacks the scope (user logged in before directory.readonly was added)
      return res.json({ users: [], needsReauth: true });
    }
    console.error(`[Directory] People API error: ${error.message}`);
    return res.json({ users: [], needsReauth: false });
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

// ── Skill pipeline orchestration ─────────────────────────────────────────────
// Profiles hold an ordered pipeline of stages. Each stage runs a set of base
// skills (in parallel within the stage) after an optional condition check
// against prior-stage output. Stages execute sequentially in position order.
//
// Base skill IDs mirror src/skills.ts — treated as opaque strings server-side.

const BASE_SKILL_IDS = [
  'base-email-triage',
  'base-email-voice',
  'base-slack-triage',
  'base-salesforce-triage',
];

// Build a SkillProfile object from flat stage-join rows (one row per stage).
function buildProfileFromRows(rows) {
  if (!rows.length) return null;
  const first = rows[0];
  const stageMap = new Map();
  for (const row of rows) {
    if (!row.stage_id) continue;
    if (!stageMap.has(row.stage_id)) {
      stageMap.set(row.stage_id, {
        id: row.stage_id,
        name: row.stage_name,
        position: row.position,
        skillIds: row.stage_skill_ids ? row.stage_skill_ids.split(',') : [],
        condition: row.condition_json ? JSON.parse(row.condition_json) : null,
      });
    }
  }
  const stages = [...stageMap.values()].sort((a, b) => a.position - b.position);
  return {
    id: first.id,
    name: first.name,
    description: first.description ?? undefined,
    stages,
    createdAt: first.created_at,
    updatedAt: first.updated_at,
  };
}

// Replace all stages for a profile atomically (delete → re-insert).
async function saveStages(pool, profileId, stages) {
  await pool.query('DELETE FROM skill_pipeline_stages WHERE profile_id = ?', [profileId]);
  if (!stages?.length) return;
  for (let i = 0; i < stages.length; i++) {
    const { name, skillIds, condition } = stages[i];
    const stageId = uuidv4();
    await pool.query(
      'INSERT INTO skill_pipeline_stages (id, profile_id, name, position, condition_json) VALUES (?, ?, ?, ?, ?)',
      [stageId, profileId, (name || `Stage ${i + 1}`).trim(), i,
        condition ? JSON.stringify(condition) : null],
    );
    const valid = (skillIds ?? []).filter((sid) => BASE_SKILL_IDS.includes(sid));
    if (valid.length > 0) {
      await pool.query(
        `INSERT INTO skill_pipeline_stage_items (stage_id, skill_id) VALUES ${valid.map(() => '(?,?)').join(',')}`,
        valid.flatMap((sid) => [stageId, sid]),
      );
    }
  }
}

// Fetch a single profile (with stages) by id.
async function fetchProfile(pool, id) {
  const [rows] = await pool.query(
    `SELECT sp.id, sp.name, sp.description, sp.created_at, sp.updated_at,
            sps.id AS stage_id, sps.name AS stage_name, sps.position, sps.condition_json,
            GROUP_CONCAT(spsi.skill_id ORDER BY spsi.skill_id SEPARATOR ',') AS stage_skill_ids
     FROM skill_profiles sp
     LEFT JOIN skill_pipeline_stages sps ON sps.profile_id = sp.id
     LEFT JOIN skill_pipeline_stage_items spsi ON spsi.stage_id = sps.id
     WHERE sp.id = ?
     GROUP BY sp.id, sps.id
     ORDER BY sps.position`,
    [id],
  );
  return buildProfileFromRows(rows);
}

// GET /api/skills/me — user's assigned pipeline profile + per-skill overrides.
app.get('/api/skills/me', async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  if (!dbPool) return res.json({ profile: null, overrides: {} });

  const userId = session.user.id;
  const [[stageRows], [overrideRows]] = await Promise.all([
    dbPool.query(
      `SELECT sp.id, sp.name, sp.description, sp.created_at, sp.updated_at,
              sps.id AS stage_id, sps.name AS stage_name, sps.position, sps.condition_json,
              GROUP_CONCAT(spsi.skill_id ORDER BY spsi.skill_id SEPARATOR ',') AS stage_skill_ids
       FROM user_skill_profiles usp
       JOIN skill_profiles sp ON sp.id = usp.profile_id
       LEFT JOIN skill_pipeline_stages sps ON sps.profile_id = sp.id
       LEFT JOIN skill_pipeline_stage_items spsi ON spsi.stage_id = sps.id
       WHERE usp.user_id = ?
       GROUP BY sp.id, sps.id
       ORDER BY sps.position`,
      [userId],
    ),
    dbPool.query(
      'SELECT skill_id, enabled FROM user_skill_overrides WHERE user_id = ?',
      [userId],
    ),
  ]);

  res.json({
    profile: buildProfileFromRows(stageRows),
    overrides: Object.fromEntries(overrideRows.map((r) => [r.skill_id, r.enabled === 1])),
  });
});

// PUT /api/skills/me/overrides/:skillId — toggle a base skill on/off for the current user.
app.put('/api/skills/me/overrides/:skillId', async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  if (!dbPool) return res.status(503).json({ error: 'Database not available' });

  const { skillId } = req.params;
  if (!BASE_SKILL_IDS.includes(skillId)) {
    return res.status(400).json({ error: 'Unknown skill ID' });
  }
  const enabled = req.body?.enabled !== false ? 1 : 0;
  await dbPool.query(
    `INSERT INTO user_skill_overrides (user_id, skill_id, enabled) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
    [session.user.id, skillId, enabled],
  );
  res.json({ ok: true });
});

// GET /api/admin/skill-profiles — all profiles with full pipeline stages.
app.get('/api/admin/skill-profiles', async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;
  if (!dbPool) return res.json({ profiles: [] });

  const [rows] = await dbPool.query(
    `SELECT sp.id, sp.name, sp.description, sp.created_at, sp.updated_at,
            sps.id AS stage_id, sps.name AS stage_name, sps.position, sps.condition_json,
            GROUP_CONCAT(spsi.skill_id ORDER BY spsi.skill_id SEPARATOR ',') AS stage_skill_ids
     FROM skill_profiles sp
     LEFT JOIN skill_pipeline_stages sps ON sps.profile_id = sp.id
     LEFT JOIN skill_pipeline_stage_items spsi ON spsi.stage_id = sps.id
     GROUP BY sp.id, sps.id
     ORDER BY sp.name, sps.position`,
  );

  // Group flat rows into profiles
  const profileMap = new Map();
  for (const row of rows) {
    if (!profileMap.has(row.id)) {
      profileMap.set(row.id, {
        id: row.id, name: row.name,
        description: row.description ?? undefined,
        stages: [],
        createdAt: row.created_at, updatedAt: row.updated_at,
      });
    }
    if (row.stage_id) {
      profileMap.get(row.id).stages.push({
        id: row.stage_id, name: row.stage_name,
        position: row.position,
        skillIds: row.stage_skill_ids ? row.stage_skill_ids.split(',') : [],
        condition: row.condition_json ? JSON.parse(row.condition_json) : null,
      });
    }
  }
  res.json({ profiles: [...profileMap.values()] });
});

// POST /api/admin/skill-profiles — create a profile with an initial pipeline.
// Body: { name, description?, stages: [{ name, skillIds, condition }] }
app.post('/api/admin/skill-profiles', async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;
  if (!dbPool) return res.status(503).json({ error: 'Database not available' });

  const { name, description, stages } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  const id = uuidv4();
  await dbPool.query(
    'INSERT INTO skill_profiles (id, name, description, created_by) VALUES (?, ?, ?, ?)',
    [id, name.trim(), description?.trim() || null, session.user.id],
  );
  await saveStages(dbPool, id, stages ?? []);

  const profile = await fetchProfile(dbPool, id);
  res.status(201).json({ profile });
});

// PUT /api/admin/skill-profiles/:id — update name, description, and full pipeline.
// Body: { name, description?, stages: [{ name, skillIds, condition }] }
app.put('/api/admin/skill-profiles/:id', async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;
  if (!dbPool) return res.status(503).json({ error: 'Database not available' });

  const { id } = req.params;
  const { name, description, stages } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  await dbPool.query(
    'UPDATE skill_profiles SET name = ?, description = ? WHERE id = ?',
    [name.trim(), description?.trim() || null, id],
  );
  await saveStages(dbPool, id, stages ?? []);

  const profile = await fetchProfile(dbPool, id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  res.json({ profile });
});

// DELETE /api/admin/skill-profiles/:id — cascades stages + items; NULLs user assignments.
app.delete('/api/admin/skill-profiles/:id', async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;
  if (!dbPool) return res.status(503).json({ error: 'Database not available' });

  await dbPool.query('DELETE FROM skill_profiles WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// POST /api/admin/users/:userId/skill-profile — assign (or unassign) a profile.
// Body: { profileId: string | null }
app.post('/api/admin/users/:userId/skill-profile', async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;
  if (!dbPool) return res.status(503).json({ error: 'Database not available' });

  const { userId } = req.params;
  const { profileId } = req.body ?? {};

  if (!profileId) {
    await dbPool.query('DELETE FROM user_skill_profiles WHERE user_id = ?', [userId]);
  } else {
    await dbPool.query(
      `INSERT INTO user_skill_profiles (user_id, profile_id, assigned_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE profile_id = VALUES(profile_id), assigned_by = VALUES(assigned_by),
         assigned_at = CURRENT_TIMESTAMP`,
      [userId, profileId, session.user.id],
    );
  }
  res.json({ ok: true });
});

// ── Agent registry ────────────────────────────────────────────────────────────
// Static definition of the managed-agent hierarchy, mirroring managed-agents/*.md
// and orchestrator/src/control-plane/departments.ts. No auth required — this is
// structural metadata, not user data.
const AGENT_REGISTRY = {
  orchestrator: {
    id: 'ceo_orchestrator',
    name: 'CEO Orchestrator',
    tier: 'orchestrator',
    model: 'claude-opus-4-8',
    mandate: 'Master coordinator. Understands user intent, delegates to the right department head(s), synthesizes results. No tools except delegation.',
    tools: ['Agent (delegation only)'],
    delegates_to: ['communications_manager', 'operations_manager', 'calendar_manager', 'receptionist', 'finance_manager'],
    contract_file: 'managed-agents/ceo-orchestrator.md',
  },
  departments: [
    {
      id: 'communications_manager',
      name: 'Communications Manager',
      tier: 'department',
      model: 'claude-sonnet-4-6',
      mandate: 'Outbound external communications — email and Slack. Draft freely; send is approval-gated.',
      tools: ['slack_send_message_draft', 'slack_send_message', 'slack_search_channels', 'gmail_create_draft', 'gmail_list_drafts'],
      mcp_servers: ['slack', 'gmail'],
      contract_file: 'managed-agents/communications-manager.md',
    },
    {
      id: 'operations_manager',
      name: 'Operations Manager',
      tier: 'department',
      model: 'claude-sonnet-4-6',
      mandate: 'Task and work management in ClickUp. Create, update, and report on tasks. Mutations are approval-gated.',
      tools: ['clickup_create_task', 'clickup_update_task', 'clickup_filter_tasks', 'clickup_get_task', 'clickup_get_workspace_hierarchy'],
      mcp_servers: ['clickup'],
      contract_file: 'managed-agents/operations-manager.md',
    },
    {
      id: 'calendar_manager',
      name: 'Calendar Manager',
      tier: 'department',
      model: 'claude-sonnet-4-6',
      mandate: 'Calendar ownership — scheduling, rescheduling, and protecting time. Create/move/cancel is approval-gated.',
      tools: ['gcal_list_events', 'gcal_list_calendars', 'gcal_suggest_time', 'gcal_create_event', 'gcal_update_event', 'gcal_delete_event'],
      mcp_servers: ['gcal'],
      contract_file: 'managed-agents/calendar-manager.md',
    },
    {
      id: 'receptionist',
      name: 'Receptionist',
      tier: 'department',
      model: 'claude-sonnet-4-6',
      mandate: 'Inbound email triage — classify, summarize, and label. Read + draft only; never sends.',
      tools: ['gmail_search_threads', 'gmail_get_thread', 'gmail_list_labels', 'gmail_label_thread', 'gmail_create_draft'],
      mcp_servers: ['gmail'],
      contract_file: 'managed-agents/receptionist.md',
    },
    {
      id: 'finance_manager',
      name: 'Finance Manager',
      tier: 'department',
      model: 'claude-sonnet-4-6',
      mandate: 'Accounting and finance — query data, build summaries, flag anomalies. Read-only; never writes to financial systems.',
      tools: ['bigquery_query', 'bigquery_list_datasets'],
      mcp_servers: ['bigquery'],
      contract_file: 'managed-agents/finance-manager.md',
    },
    {
      id: 'intelligence_agent',
      name: 'Intelligence Agent',
      tier: 'department',
      model: 'claude-sonnet-4-6',
      mandate: 'Builds contact personas from communication history across email and Slack. Searches past threads and messages, extracts relationship signals and communication style, and delivers a structured profile to support better drafting. Read-only — never sends or mutates. Expands to CRM and Calendar as systems come online.',
      tools: ['gmail_search_threads', 'gmail_get_thread', 'gmail_list_labels', 'slack_contact_profile', 'slack_channel_history', 'slack_channels_list'],
      mcp_servers: ['gmail_history', 'slack_history'],
      contract_file: 'managed-agents/intelligence-agent.md',
    },
  ],
};

app.get('/api/agents', (_req, res) => {
  res.json(AGENT_REGISTRY);
});

// ── Skill metadata + user-editable rules ─────────────────────────────────────

const SKILL_META = {
  slack: {
    description: 'Reads messages and posts responses across Slack channels and direct messages.',
    tools: ['slack_send_message', 'slack_list_channels', 'slack_read_messages'],
    defaultRules: [
      'Business hours only (Mon–Fri, 8 am–6 pm CT)',
      'No external workspace channels',
      'Respond in the same channel or thread as the original message',
    ],
  },
  gmail: {
    description: 'Reads email threads and creates drafts via Gmail OAuth. Cannot send — drafts only.',
    tools: ['gmail_draft', 'gmail_read_thread', 'gmail_list_inbox'],
    defaultRules: [
      'Drafts only — never send',
      'Always include a confidentiality footer on outbound drafts',
      'Deduplicate: skip threads already on the board',
    ],
  },
  gcal: {
    description: 'Reads, creates, and updates events on Google Calendar on behalf of the user.',
    tools: ['gcal_list_events', 'gcal_create_event', 'gcal_update_event'],
    defaultRules: [
      'Never delete or cancel existing events without explicit confirmation',
      'Booking windows: Mon–Fri, 9 am–5 pm CT only',
      'Always include a video-conference link for new meetings',
    ],
  },
  clickup: {
    description: 'Creates and manages tasks, subtasks, and projects in ClickUp.',
    tools: ['clickup_create_task', 'clickup_list_tasks', 'clickup_update_task'],
    defaultRules: [
      'Set due dates only when explicitly requested',
      'Tag every task with its source (email or Slack) for audit trail',
      'Never move tasks between spaces without explicit instruction',
    ],
  },
  bigquery: {
    description: 'Queries financial and operational data from BigQuery — read-only access.',
    tools: ['bigquery_query', 'bigquery_list_tables', 'bigquery_get_table'],
    defaultRules: [
      'Read-only — no INSERT, UPDATE, or DELETE statements',
      'Queries are scoped to the current organization only',
      'Always cite the table and date range in the summary',
    ],
  },
  gmail_history: {
    description: 'Reads past email threads to extract communication patterns, relationship signals, and contact personas. Strictly read-only — no drafts, no mutations.',
    tools: ['gmail_search_threads', 'gmail_get_thread', 'gmail_list_labels'],
    defaultRules: [
      'Read-only — no drafts, labels, or mutations of any kind',
      'Summarize content only; never reproduce verbatim privileged text',
      'Scope every search to the authenticated user\'s mailbox only',
      'Always cite thread date and subject for every claim in a persona',
      'Return { history: "none found" } when no past threads exist — never block the pipeline',
    ],
  },
  slack_history: {
    description: 'Searches Slack message history to build contact personas — communication style, channels, topics, and relationship patterns. Read-only. Powers the Intelligence Agent persona engine.',
    tools: ['slack_contact_profile', 'slack_channel_history', 'slack_channels_list'],
    defaultRules: [
      'Read-only — never posts, reacts, or mutates any Slack state',
      'Scope searches to the authenticated user\'s workspace only',
      'Summarize patterns; never reproduce verbatim message content in logs or traces',
      'Cite channel name and approximate date for every signal in a persona',
      'If contact is not found in Slack, return gracefully and continue the pipeline',
    ],
  },
};

async function ensureSkillRulesSchema(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS skill_rules (
      id VARCHAR(36) PRIMARY KEY,
      skill_id VARCHAR(100) NOT NULL,
      rule_text TEXT NOT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_skill_id (skill_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function seedSkillRules(pool) {
  const [existing] = await pool.query('SELECT COUNT(*) AS cnt FROM skill_rules');
  if (existing[0].cnt > 0) return;
  for (const [skillId, meta] of Object.entries(SKILL_META)) {
    for (const rule of meta.defaultRules) {
      await pool.query(
        'INSERT INTO skill_rules (id, skill_id, rule_text, is_default) VALUES (?, ?, ?, 1)',
        [uuidv4(), skillId, rule]
      );
    }
  }
}

app.get('/api/skill-rules', async (_req, res) => {
  const base = Object.fromEntries(
    Object.entries(SKILL_META).map(([id, meta]) => [id, { description: meta.description, tools: meta.tools, rules: [] }])
  );
  if (!dbPool) return res.json({ skills: base });
  try {
    const [rows] = await dbPool.query(
      'SELECT id, skill_id, rule_text, is_default FROM skill_rules ORDER BY is_default DESC, created_at ASC'
    );
    for (const row of rows) {
      if (base[row.skill_id]) {
        base[row.skill_id].rules.push({ id: row.id, text: row.rule_text, isDefault: !!row.is_default });
      }
    }
    res.json({ skills: base });
  } catch (e) {
    console.error('[skill-rules] GET failed:', e.message);
    res.json({ skills: base });
  }
});

app.post('/api/skill-rules/:skillId/rules', async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  if (!dbPool) return res.status(503).json({ error: 'Database unavailable' });

  const { skillId } = req.params;
  if (!SKILL_META[skillId]) return res.status(400).json({ error: 'Unknown skill' });

  const { ruleText } = req.body;
  if (!ruleText || typeof ruleText !== 'string' || !ruleText.trim()) {
    return res.status(400).json({ error: 'ruleText required' });
  }

  const id = uuidv4();
  try {
    await dbPool.query(
      'INSERT INTO skill_rules (id, skill_id, rule_text, is_default) VALUES (?, ?, ?, 0)',
      [id, skillId, ruleText.trim()]
    );
    res.json({ id, skillId, text: ruleText.trim(), isDefault: false });
  } catch (e) {
    console.error('[skill-rules] POST failed:', e.message);
    res.status(500).json({ error: 'Failed to add rule' });
  }
});

app.delete('/api/skill-rules/:skillId/rules/:ruleId', async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  if (!dbPool) return res.status(503).json({ error: 'Database unavailable' });

  const { skillId, ruleId } = req.params;
  try {
    await dbPool.query(
      'DELETE FROM skill_rules WHERE id = ? AND skill_id = ?',
      [ruleId, skillId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[skill-rules] DELETE failed:', e.message);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

// ── User settings (onboarding state, preferences) ────────────────────────────

async function ensureUserSettingsSchema(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS user_settings (
      user_id VARCHAR(255) PRIMARY KEY,
      onboarding_completed_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

app.get('/api/user-settings', async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  if (!dbPool) return res.json({ onboardingCompleted: false });
  try {
    const [rows] = await dbPool.query(
      'SELECT onboarding_completed_at FROM user_settings WHERE user_id = ?',
      [session.email]
    );
    res.json({ onboardingCompleted: rows.length > 0 && rows[0].onboarding_completed_at != null });
  } catch (e) {
    console.error('[user-settings] GET failed:', e.message);
    res.json({ onboardingCompleted: false });
  }
});

app.post('/api/user-settings/onboarding-complete', async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  if (!dbPool) return res.json({ ok: true });
  try {
    await dbPool.query(
      `INSERT INTO user_settings (user_id, onboarding_completed_at) VALUES (?, NOW())
       ON DUPLICATE KEY UPDATE onboarding_completed_at = NOW()`,
      [session.email]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[user-settings] POST failed:', e.message);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ── Agent feature pipelines ───────────────────────────────────────────────────
// Persists which agents (and in what order) handle each app feature.

async function ensureAgentPipelineSchema(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS agent_feature_pipelines (
      id VARCHAR(36) PRIMARY KEY,
      feature_key VARCHAR(100) NOT NULL,
      name VARCHAR(255) NOT NULL,
      UNIQUE KEY unique_fk (feature_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS agent_pipeline_steps (
      id VARCHAR(36) PRIMARY KEY,
      pipeline_id VARCHAR(36) NOT NULL,
      agent_id VARCHAR(100) NOT NULL,
      position INT NOT NULL,
      KEY idx_pipeline (pipeline_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function loadPipelines(pool) {
  const [pipes] = await pool.query(
    'SELECT id, feature_key, name FROM agent_feature_pipelines'
  );
  const [steps] = await pool.query(
    'SELECT pipeline_id, agent_id, position FROM agent_pipeline_steps ORDER BY position ASC'
  );
  const stepsByPipe = {};
  for (const s of steps) {
    (stepsByPipe[s.pipeline_id] = stepsByPipe[s.pipeline_id] || []).push(s);
  }
  return pipes.map((p) => ({
    featureKey: p.feature_key,
    name: p.name,
    agentIds: (stepsByPipe[p.id] || []).map((s) => s.agent_id),
  }));
}

app.get('/api/agent-pipelines', async (_req, res) => {
  if (!dbPool) return res.json({ pipelines: [] });
  try {
    res.json({ pipelines: await loadPipelines(dbPool) });
  } catch (e) {
    console.error('[agent-pipelines] GET failed:', e.message);
    // Return empty list so the UI falls back to feature defaults gracefully
    res.json({ pipelines: [] });
  }
});

app.put('/api/agent-pipelines/:featureKey', async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;
  if (!dbPool) return res.status(503).json({ error: 'Database unavailable' });

  const { featureKey } = req.params;
  const { name, agentIds } = req.body;

  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  if (!Array.isArray(agentIds)) return res.status(400).json({ error: 'agentIds array required' });

  // Validate all agentIds exist in registry
  const allAgentIds = [AGENT_REGISTRY.orchestrator.id, ...AGENT_REGISTRY.departments.map((d) => d.id)];
  const invalid = agentIds.filter((id) => !allAgentIds.includes(id));
  if (invalid.length) return res.status(400).json({ error: `Unknown agent ids: ${invalid.join(', ')}` });

  try {
    // Upsert pipeline row
    const pipelineId = uuidv4();
    await dbPool.query(
      `INSERT INTO agent_feature_pipelines (id, feature_key, name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), name=VALUES(name)`,
      [pipelineId, featureKey, name]
    );
    const [[{ resolvedId }]] = await dbPool.query(
      'SELECT id AS resolvedId FROM agent_feature_pipelines WHERE feature_key = ?',
      [featureKey]
    );
    // Replace steps atomically
    await dbPool.query('DELETE FROM agent_pipeline_steps WHERE pipeline_id = ?', [resolvedId]);
    for (let i = 0; i < agentIds.length; i++) {
      await dbPool.query(
        'INSERT INTO agent_pipeline_steps (id, pipeline_id, agent_id, position) VALUES (?, ?, ?, ?)',
        [uuidv4(), resolvedId, agentIds[i], i]
      );
    }
    res.json({ ok: true, featureKey, agentIds });
  } catch (e) {
    console.error('[agent-pipelines] PUT failed:', e.message);
    res.status(500).json({ error: 'Failed to save pipeline' });
  }
});

// Serve the built React SPA in production. API routes above take priority;
// anything unmatched falls through to the static dir, then index.html (SPA routing).
const distDir = new URL('../dist', import.meta.url).pathname;
app.use(express.static(distDir));
app.get('/{*splat}', (_req, res) => {
  res.sendFile(new URL('../dist/index.html', import.meta.url).pathname);
});

app.listen(PORT, () => {
  if (dbPool) {
    // Core app schema (users, sessions, gmail_accounts, …) then flags/roles.
    // Both idempotent; runs every boot so the DB can't be half-migrated.
    ensureCoreSchema(dbPool)
      .then(() => initFlagSchema())
      .then(() => ensureAgentPipelineSchema(dbPool))
      .then(() => ensureSkillRulesSchema(dbPool))
      .then(() => seedSkillRules(dbPool))
      .then(() => ensureUserSettingsSchema(dbPool))
      .then(() => ensureSlackTokensSchema(dbPool))
      .then(() => loadSessionsFromDb())
      .then(() => loadSlackAccount(dbPool))
      .catch((e) => console.error(`[DB] Schema init failed: ${e.message}`));
  }
  console.log(`Relay API listening on http://localhost:${PORT}`);
  console.log(`[Config] Allowed domains: ${ALLOWED_DOMAINS.join(', ')}`);
  console.log(`[Config] Allowed origins: ${allowedOrigins.join(', ')}`);
});
