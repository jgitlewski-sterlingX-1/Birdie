import { apiFetch } from './apiClient';
import type { User } from './types';

export interface DirectoryResult {
  users: User[];
  needsReauth: boolean;
}

export async function fetchDirectoryUsers(sessionId: string): Promise<DirectoryResult> {
  const res = await apiFetch(`/api/directory/users?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) return { users: [], needsReauth: false };
  return res.json() as Promise<DirectoryResult>;
}
