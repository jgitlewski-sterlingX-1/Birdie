export interface GmailIntegrationStatus {
  status: 'connected' | 'disconnected';
  accountEmail: string | null;
  lastConnectedAt: string | null;
  scopes: string[];
}

interface IntegrationsResponse {
  gmail: GmailIntegrationStatus;
}

export async function getIntegrationsStatus(): Promise<IntegrationsResponse> {
  const res = await fetch('/api/integrations');
  if (!res.ok) throw new Error('Failed to fetch integrations status');
  return res.json() as Promise<IntegrationsResponse>;
}

export async function startGmailConnect(): Promise<string> {
  const res = await fetch('/api/integrations/gmail/connect');
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to start Gmail connection' }));
    throw new Error(data.error || 'Failed to start Gmail connection');
  }
  const data = (await res.json()) as { authUrl: string };
  return data.authUrl;
}

export async function disconnectGmail(): Promise<void> {
  const res = await fetch('/api/integrations/gmail/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to disconnect Gmail');
}
