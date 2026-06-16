import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';

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
  GMAIL_REDIRECT_URI = 'http://localhost:8787/api/integrations/gmail/callback',
} = process.env;

const gmailState = {
  connected: false,
  accountEmail: null,
  userDomain: null,
  scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'],
  lastConnectedAt: null,
  token: null,
};

function getOAuthClient() {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    return null;
  }
  return new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI);
}

app.get('/api/integrations', (_req, res) => {
  res.json({
    gmail: {
      status: gmailState.connected ? 'connected' : 'disconnected',
      accountEmail: gmailState.accountEmail,
      userDomain: gmailState.userDomain,
      lastConnectedAt: gmailState.lastConnectedAt,
      scopes: gmailState.scopes,
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
    scope: gmailState.scopes,
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

    // Domain is authorized; update state
    gmailState.connected = true;
    gmailState.accountEmail = accountEmail;
    gmailState.userDomain = emailDomain;
    gmailState.lastConnectedAt = new Date().toISOString();
    gmailState.token = tokens;

    console.log(`[OAuth] Connected: ${accountEmail} (domain: ${emailDomain})`);

    return res.redirect('http://localhost:5174?gmail=connected');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown OAuth error';
    console.error(`[OAuth] Callback error: ${message}`);
    return res.status(500).send(`OAuth callback failed: ${message}`);
  }
});

app.post('/api/integrations/gmail/disconnect', (_req, res) => {
  gmailState.connected = false;
  gmailState.accountEmail = null;
  gmailState.userDomain = null;
  gmailState.lastConnectedAt = null;
  gmailState.token = null;
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Relay API listening on http://localhost:${PORT}`);
  console.log(`[Config] Allowed domains: ${ALLOWED_DOMAINS.join(', ')}`);
  console.log(`[Config] Allowed origins: ${allowedOrigins.join(', ')}`);
});
