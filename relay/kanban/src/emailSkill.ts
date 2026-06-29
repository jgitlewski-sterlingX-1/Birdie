// src/emailSkill.ts — prototype email skill (heuristic stand-in; replaced by Claude in production)

import type { Card, Skill, EmailRule } from './types';
import { checkEmailRules } from './emailGroupsStore';

/**
 * Summarise an email thread. In production, this is a Claude call on the server.
 */
export function summarizeThread(messages: { from: string; body: string }[]): string {
  // Prototype: return a stub summary
  const latest = messages[messages.length - 1];
  const snippet = latest.body.slice(0, 120).replace(/\s+/g, ' ');
  return `[AI summary — prototype] ${snippet}${latest.body.length > 120 ? '…' : ''}`;
}

/**
 * Extract action items from an email thread as subtask titles.
 * In production, this is a Claude call on the server.
 */
export function extractTodos(messages: { body: string }[]): string[] {
  // Prototype: heuristic extraction — look for imperative phrases
  const combined = messages.map((m) => m.body).join('\n');
  const lines = combined.split(/[.!?\n]/);
  const actionPhrases = ['please', 'could you', 'can you', 'need you to', 'review', 'confirm', 'send', 'provide'];
  const todos: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase().trim();
    if (actionPhrases.some((p) => lower.includes(p)) && line.trim().length > 10) {
      todos.push(line.trim());
      if (todos.length >= 3) break;
    }
  }
  return todos.length > 0 ? todos : ['Review and respond to this email'];
}

/**
 * Run the email skill on a card. Sets summary + creates subtask titles.
 * Returns the extracted todo titles (caller creates the actual subtask cards).
 */
export function runEmailSkill(card: Card): {
  summary: string;
  todoTitles: string[];
} {
  if (!card.emailThread || card.todosExtracted) {
    return { summary: card.summary ?? '', todoTitles: [] };
  }
  const summary = summarizeThread(card.emailThread);
  const todoTitles = extractTodos(card.emailThread);
  return { summary, todoTitles };
}

/**
 * Email skill pipeline: the base triage skill runs first (summary + to-dos that
 * affect the user), then any enabled custom email skills run AFTER it, layering
 * on top without changing the base output.
 *
 * In production each step is a Claude call on the server; here the base step is
 * the heuristic above and custom steps are structural stand-ins that annotate
 * the summary and record that they ran. This preserves the base-then-custom
 * ordering so real skill logic can drop in later.
 */
export function runEmailPipeline(
  messages: { from: string; date?: string; body: string }[],
  customSkills: Skill[],
  rules: EmailRule[] = []
): { summary: string; todoTitles: string[]; skillsApplied: string[]; ignored: boolean } {
  // Check ignore rules before any AI work — cheapest gate.
  const latest = messages[messages.length - 1] ?? { from: '', body: '' };
  const subject = latest.body.slice(0, 80);
  const matchedRule = checkEmailRules({ from: latest.from, subject }, rules);
  if (matchedRule) {
    return { summary: '', todoTitles: [], skillsApplied: ['ignore-rule'], ignored: true };
  }

  const todoTitles = extractTodos(messages);
  let summary = summarizeThread(messages);
  const skillsApplied = ['base-email-triage'];

  for (const skill of customSkills) {
    skillsApplied.push(skill.id);
    summary += `\n\n[custom skill · ${skill.name}] applied after base triage.`;
  }

  return { summary, todoTitles, skillsApplied, ignored: false };
}
