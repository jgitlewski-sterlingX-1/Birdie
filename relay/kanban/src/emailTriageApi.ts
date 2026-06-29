import { apiFetch } from './apiClient';

export interface TriageRequest {
  messages: { from: string; date?: string; body: string }[];
  subject: string;
}

export interface TriageResult {
  summary: string;
  todoTitles: string[];
}

export async function triageThread(sessionId: string, payload: TriageRequest): Promise<TriageResult> {
  const res = await apiFetch(`/api/email/triage?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Triage failed' }));
    throw new Error(data.error || 'Triage failed');
  }
  return res.json() as Promise<TriageResult>;
}
