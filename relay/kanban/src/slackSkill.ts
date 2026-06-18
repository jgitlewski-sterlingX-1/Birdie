// src/slackSkill.ts — prototype Slack triage skill (heuristic stand-in; Claude in production)

import type { Skill } from './types';
import { extractTodos } from './emailSkill';

/**
 * Slack triage pipeline: base triage first (summary + action items that affect
 * the user), then enabled custom Slack skills layered after. Mirrors the email
 * pipeline; the heuristic here is replaced by a Claude call server-side later.
 */
export function runSlackPipeline(
  text: string,
  customSkills: Skill[]
): { summary: string; todoTitles: string[]; skillsApplied: string[] } {
  const clean = text.replace(/\s+/g, ' ').trim();
  let summary = `[AI summary — prototype] ${clean.slice(0, 140)}${clean.length > 140 ? '…' : ''}`;
  const todoTitles = extractTodos([{ body: text }]);
  const skillsApplied = ['base-slack-triage'];

  for (const skill of customSkills) {
    skillsApplied.push(skill.id);
    summary += `\n\n[custom skill · ${skill.name}] applied after base triage.`;
  }

  return { summary, todoTitles, skillsApplied };
}
