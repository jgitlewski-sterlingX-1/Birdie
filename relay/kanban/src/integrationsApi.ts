import { apiFetch } from './apiClient';

export interface GmailConnectedAccount {
  accountEmail: string;
  userDomain: string | null;
  lastConnectedAt: string | null;
  scopes: string[];
  source: 'auth-login' | 'gmail-connect';
}

export interface GmailIntegrationStatus {
  status: 'connected' | 'disconnected';
  accountEmail: string | null;
  userDomain: string | null;
  lastConnectedAt: string | null;
  scopes: string[];
  defaultAccountEmail: string | null;
  accounts: GmailConnectedAccount[];
}

export interface ClaudeIntegrationStatus {
  status: 'connected' | 'disconnected';
  accountLabel?: string | null;
  platformKeyAvailable?: boolean;
  model: string;
}

export interface SimpleIntegrationStatus {
  status: 'connected' | 'disconnected';
  available?: boolean;
}

export interface SlackIntegrationStatus {
  status: 'connected' | 'disconnected';
  available?: boolean;
  teamName?: string | null;
  authedUserId?: string | null;
  scopes?: string[];
  connectedAt?: string | null;
}

interface IntegrationsResponse {
  gmail: GmailIntegrationStatus;
  claude: ClaudeIntegrationStatus;
  slack: SlackIntegrationStatus;
  clickup: SimpleIntegrationStatus;
}

export interface SalesforceAccount {
  id: string;
  username: string;
  orgId: string;
  instanceUrl: string;
  status: string;
  isDefault: boolean;
  connectedAt?: string;
}

export interface SalesforceStatus {
  status: 'connected' | 'disconnected';
  accounts: SalesforceAccount[];
}

export interface PolledEmail {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  body: string;
  date: string;
}

export async function getIntegrationsStatus(sessionId?: string): Promise<IntegrationsResponse> {
  const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  const res = await apiFetch(`/api/integrations${q}`);
  if (!res.ok) throw new Error('Failed to fetch integrations status');
  return res.json() as Promise<IntegrationsResponse>;
}

// Claude is a per-user API key (no OAuth) — store / clear the user's key.
export async function connectClaude(sessionId: string, apiKey: string): Promise<void> {
  const res = await apiFetch(`/api/integrations/claude/connect?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to connect Claude' }));
    throw new Error(data.error || 'Failed to connect Claude');
  }
}

export async function disconnectClaude(sessionId: string): Promise<void> {
  const res = await apiFetch(`/api/integrations/claude/disconnect?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to disconnect Claude');
}

// Salesforce lives behind the DB; degrade gracefully to "disconnected" when the
// DB isn't configured (in-memory mode) or the call fails.
export async function getSalesforceStatus(sessionId: string): Promise<SalesforceStatus> {
  try {
    const res = await apiFetch(`/api/integrations/salesforce?sessionId=${encodeURIComponent(sessionId)}`);
    if (!res.ok) return { status: 'disconnected', accounts: [] };
    const data = (await res.json()) as { salesforce?: SalesforceStatus };
    return data.salesforce ?? { status: 'disconnected', accounts: [] };
  } catch {
    return { status: 'disconnected', accounts: [] };
  }
}

export async function startGmailConnect(): Promise<string> {
  const res = await apiFetch('/api/integrations/gmail/connect');
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to start Gmail connection' }));
    throw new Error(data.error || 'Failed to start Gmail connection');
  }
  const data = (await res.json()) as { authUrl: string };
  return data.authUrl;
}

export async function startSlackConnect(): Promise<string> {
  const res = await apiFetch('/api/integrations/slack/connect');
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to start Slack connection' }));
    throw new Error(data.error || 'Failed to start Slack connection');
  }
  const data = (await res.json()) as { authUrl: string };
  return data.authUrl;
}

export async function disconnectSlack(): Promise<void> {
  const res = await apiFetch('/api/integrations/slack/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to disconnect Slack');
}

export async function disconnectGmail(accountEmail?: string): Promise<void> {
  const res = await apiFetch('/api/integrations/gmail/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountEmail }),
  });
  if (!res.ok) throw new Error('Failed to disconnect Gmail');
}

export async function setDefaultGmailAccount(accountEmail: string): Promise<void> {
  const res = await apiFetch('/api/integrations/gmail/default', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountEmail }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to set default Gmail account' }));
    throw new Error(data.error || 'Failed to set default Gmail account');
  }
}

export interface PolledSlackMessage {
  messageId: string;
  channelId?: string | null;
  channelName?: string | null;
  from: string;
  text: string;
  ts: string;
  permalink?: string | null;
}

export async function pollSlackMessages(sessionId: string): Promise<PolledSlackMessage[]> {
  const res = await apiFetch(`/api/slack/poll?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to poll Slack' }));
    throw new Error(data.error || 'Failed to poll Slack');
  }
  const data = (await res.json()) as { messages: PolledSlackMessage[] };
  return data.messages ?? [];
}

export async function pollNewEmails(sessionId: string): Promise<PolledEmail[]> {
  const res = await apiFetch(`/api/email/poll?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to poll emails' }));
    throw new Error(data.error || 'Failed to poll emails');
  }
  const data = (await res.json()) as { emails: PolledEmail[] };
  return data.emails ?? [];
}

// Fire-and-forget — marks the Gmail thread as read. Never throws; a failure
// is logged server-side but doesn't surface to the user.
export async function markEmailRead(sessionId: string, threadId: string): Promise<void> {
  try {
    await apiFetch('/api/email/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, threadId }),
    });
  } catch {
    // best-effort
  }
}
