// src/skillsApi.ts — manage real Anthropic Custom Skills (/v1/skills) via the
// server, using the user's connected Claude key. These are genuine, versioned
// skills on the user's Anthropic workspace — not localStorage records.

import { apiFetch } from './apiClient';

export interface ClaudeSkill {
  id: string;
  displayTitle: string;
  latestVersion: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  // Model-facing name + description, pulled from the skill's SKILL.md frontmatter.
  name: string;
  description: string;
}

export interface ClaudeSkillInput {
  displayTitle: string;
  description: string;
  instructions: string;
  category: string;
}

export interface ClaudeSkillsResponse {
  skills: ClaudeSkill[];
  connected: boolean;
}

export async function listClaudeSkills(sessionId: string): Promise<ClaudeSkillsResponse> {
  const res = await apiFetch(`/api/skills?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to load skills' }));
    throw new Error(data.error || 'Failed to load skills');
  }
  return res.json() as Promise<ClaudeSkillsResponse>;
}

export async function createClaudeSkill(sessionId: string, input: ClaudeSkillInput): Promise<ClaudeSkill> {
  const res = await apiFetch(`/api/skills?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to create skill' }));
    throw new Error(data.error || 'Failed to create skill');
  }
  const data = (await res.json()) as { skill: ClaudeSkill };
  return data.skill;
}

export async function deleteClaudeSkill(sessionId: string, id: string): Promise<void> {
  const res = await apiFetch(`/api/skills/${encodeURIComponent(id)}?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to delete skill' }));
    throw new Error(data.error || 'Failed to delete skill');
  }
}
