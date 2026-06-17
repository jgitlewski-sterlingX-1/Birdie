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

export async function getIntegrationsStatus(): Promise<IntegrationsResponse> {
  const res = await apiFetch('/api/integrations');
  if (!res.ok) throw new Error('Failed to fetch integrations status');
  return res.json() as Promise<IntegrationsResponse>;
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

export async function pollNewEmails(sessionId: string): Promise<PolledEmail[]> {
  const res = await apiFetch(`/api/email/poll?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to poll emails' }));
    throw new Error(data.error || 'Failed to poll emails');
  }
  const data = (await res.json()) as { emails: PolledEmail[] };
  return data.emails ?? [];
}
