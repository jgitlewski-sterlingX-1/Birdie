import { apiFetch } from './apiClient';

export interface DraftRequest {
  messages: { from: string; date?: string; body: string }[];
  subject: string;
  voiceInstructions: string;
}

// Ask the server to draft an email reply in the user's voice (Claude server-side).
export async function generateDraft(sessionId: string, payload: DraftRequest): Promise<string> {
  const res = await apiFetch(`/api/email/draft?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to draft reply' }));
    throw new Error(data.error || 'Failed to draft reply');
  }
  const data = (await res.json()) as { draft: string };
  return data.draft ?? '';
}
