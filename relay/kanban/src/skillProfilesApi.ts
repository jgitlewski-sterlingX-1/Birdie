// src/skillProfilesApi.ts — skill profiles (admin) + per-user skill status/overrides

import { apiFetch } from './apiClient';
import type { SkillPipelineStage, SkillProfile, UserSkillStatus } from './types';

// Input shape for one stage (id and position are assigned server-side)
export interface StageInput {
  name: string;
  skillIds: string[];
  condition: SkillPipelineStage['condition'];
}

// ── User: my skill status ─────────────────────────────────────────────────────

export async function getMySkillStatus(sessionId: string): Promise<UserSkillStatus> {
  const res = await apiFetch(`/api/skills/me?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to load skill status' }));
    throw new Error((data as { error: string }).error || 'Failed to load skill status');
  }
  return res.json() as Promise<UserSkillStatus>;
}

export async function setSkillOverride(
  sessionId: string,
  skillId: string,
  enabled: boolean,
): Promise<void> {
  const res = await apiFetch(
    `/api/skills/me/overrides/${encodeURIComponent(skillId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, enabled }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to update skill' }));
    throw new Error((data as { error: string }).error || 'Failed to update skill');
  }
}

// ── Admin: skill profile CRUD ─────────────────────────────────────────────────

export async function listSkillProfiles(sessionId: string): Promise<SkillProfile[]> {
  const res = await apiFetch(`/api/admin/skill-profiles?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to load profiles' }));
    throw new Error((data as { error: string }).error || 'Failed to load profiles');
  }
  const data = (await res.json()) as { profiles: SkillProfile[] };
  return data.profiles;
}

export async function createSkillProfile(
  sessionId: string,
  input: { name: string; description?: string; stages: StageInput[] },
): Promise<SkillProfile> {
  const res = await apiFetch('/api/admin/skill-profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, ...input }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to create profile' }));
    throw new Error((data as { error: string }).error || 'Failed to create profile');
  }
  const data = (await res.json()) as { profile: SkillProfile };
  return data.profile;
}

export async function updateSkillProfile(
  sessionId: string,
  id: string,
  input: { name: string; description?: string; stages: StageInput[] },
): Promise<SkillProfile> {
  const res = await apiFetch(`/api/admin/skill-profiles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, ...input }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to update profile' }));
    throw new Error((data as { error: string }).error || 'Failed to update profile');
  }
  const data = (await res.json()) as { profile: SkillProfile };
  return data.profile;
}

export async function deleteSkillProfile(sessionId: string, id: string): Promise<void> {
  const res = await apiFetch(
    `/api/admin/skill-profiles/${encodeURIComponent(id)}?sessionId=${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to delete profile' }));
    throw new Error((data as { error: string }).error || 'Failed to delete profile');
  }
}

// ── Admin: assign profile to user ─────────────────────────────────────────────

export async function assignProfileToUser(
  sessionId: string,
  userId: string,
  profileId: string | null,
): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/skill-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, profileId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to assign profile' }));
    throw new Error((data as { error: string }).error || 'Failed to assign profile');
  }
}
