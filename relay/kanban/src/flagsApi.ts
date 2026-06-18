import { apiFetch } from './apiClient';

export interface FlagDefinition {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  allowedRoles: string[];
}

export interface Role {
  name: string;
  description?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  domain?: string | null;
  createdAt?: string | null;
  lastLoginAt?: string | null;
  roles: string[];
}

export interface FlagEvaluation {
  flags: Record<string, boolean>;
  roles: string[];
  isAdmin: boolean;
}

function qs(sessionId: string): string {
  return `?sessionId=${encodeURIComponent(sessionId)}`;
}

// Flags evaluated for the current user (drives gating).
export async function getFlags(sessionId: string): Promise<FlagEvaluation> {
  const res = await apiFetch(`/api/flags${qs(sessionId)}`);
  if (!res.ok) throw new Error('Failed to load flags');
  return res.json() as Promise<FlagEvaluation>;
}

// ── Admin ──────────────────────────────────────────────────────────────────

export async function getAdminFlags(sessionId: string): Promise<FlagDefinition[]> {
  const res = await apiFetch(`/api/admin/flags${qs(sessionId)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load flags');
  return (await res.json()).flags as FlagDefinition[];
}

export async function saveFlag(sessionId: string, flag: FlagDefinition): Promise<void> {
  const res = await apiFetch(`/api/admin/flags/${encodeURIComponent(flag.key)}${qs(sessionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(flag),
  });
  if (!res.ok) throw new Error('Failed to save flag');
}

export async function getAdminRoles(sessionId: string): Promise<Role[]> {
  const res = await apiFetch(`/api/admin/roles${qs(sessionId)}`);
  if (!res.ok) throw new Error('Failed to load roles');
  return (await res.json()).roles as Role[];
}

export async function createRole(sessionId: string, name: string, description: string): Promise<void> {
  const res = await apiFetch(`/api/admin/roles${qs(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) throw new Error('Failed to create role');
}

export async function getAdminUsers(sessionId: string): Promise<AdminUser[]> {
  const res = await apiFetch(`/api/admin/users${qs(sessionId)}`);
  if (!res.ok) throw new Error('Failed to load users');
  return (await res.json()).users as AdminUser[];
}

export async function setUserRoles(sessionId: string, userId: string, roles: string[]): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/roles${qs(sessionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roles }),
  });
  if (!res.ok) throw new Error('Failed to update roles');
}
