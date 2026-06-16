import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';

const app = express();
const PORT = process.env.RELAY_API_PORT || 8787;

app.use(cors({ origin: ['http://localhost:5173'] }));
app.use(express.json());

const {
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REDIRECT_URI = 'http://localhost:8787/api/integrations/gmail/callback',
} = process.env;

const gmailState = {
  connected: false,
  accountEmail: null,
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

    gmailState.connected = true;
    gmailState.accountEmail = profile.data.emailAddress || null;
    gmailState.lastConnectedAt = new Date().toISOString();
    gmailState.token = tokens;

    return res.redirect('http://localhost:5173?gmail=connected');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown OAuth error';
    return res.status(500).send(`OAuth callback failed: ${message}`);
  }
});

app.post('/api/integrations/gmail/disconnect', (_req, res) => {
  gmailState.connected = false;
  gmailState.accountEmail = null;
  gmailState.lastConnectedAt = null;
  gmailState.token = null;
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Relay API listening on http://localhost:${PORT}`);
});
