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

interface IntegrationsResponse {
  gmail: GmailIntegrationStatus;
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

export async function startGmailConnect(): Promise<string> {
  const res = await apiFetch('/api/integrations/gmail/connect');
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to start Gmail connection' }));
    throw new Error(data.error || 'Failed to start Gmail connection');
  }
  const data = (await res.json()) as { authUrl: string };
  return data.authUrl;
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
