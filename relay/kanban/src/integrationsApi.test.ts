import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disconnectGmail,
  getIntegrationsStatus,
  pollNewEmails,
  setDefaultGmailAccount,
  startGmailConnect,
} from './integrationsApi';

const apiFetchMock = vi.fn();

vi.mock('./apiClient', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

describe('integrationsApi', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('loads integrations status', async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          gmail: {
            status: 'connected',
            accountEmail: 'user@example.com',
            userDomain: 'example.com',
            lastConnectedAt: null,
            scopes: [],
            defaultAccountEmail: 'user@example.com',
            accounts: [],
          },
        }),
        { status: 200 }
      )
    );

    const result = await getIntegrationsStatus();

    expect(apiFetchMock).toHaveBeenCalledWith('/api/integrations');
    expect(result.gmail.status).toBe('connected');
  });

  it('returns auth URL when starting gmail connect', async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth' }), {
        status: 200,
      })
    );

    const authUrl = await startGmailConnect();

    expect(apiFetchMock).toHaveBeenCalledWith('/api/integrations/gmail/connect');
    expect(authUrl).toContain('google.com');
  });

  it('throws meaningful error when gmail connect fails', async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Missing Gmail OAuth environment variables.' }), {
        status: 400,
      })
    );

    await expect(startGmailConnect()).rejects.toThrow('Missing Gmail OAuth environment variables.');
  });

  it('posts account email for default gmail selection', async () => {
    apiFetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await setDefaultGmailAccount('lawyer@example.com');

    expect(apiFetchMock).toHaveBeenCalledWith('/api/integrations/gmail/default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountEmail: 'lawyer@example.com' }),
    });
  });

  it('disconnects all gmail accounts when accountEmail is omitted', async () => {
    apiFetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await disconnectGmail();

    expect(apiFetchMock).toHaveBeenCalledWith('/api/integrations/gmail/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountEmail: undefined }),
    });
  });

  it('polls new emails using encoded session id', async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          emails: [
            {
              messageId: 'msg-1',
              threadId: 'thr-1',
              from: 'client@example.com',
              subject: 'Need review',
              snippet: 'Please review this.',
              body: 'Please review this.',
              date: new Date().toISOString(),
            },
          ],
        }),
        { status: 200 }
      )
    );

    const emails = await pollNewEmails('session id/with spaces');

    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/email/poll?sessionId=session%20id%2Fwith%20spaces'
    );
    expect(emails).toHaveLength(1);
  });
});
