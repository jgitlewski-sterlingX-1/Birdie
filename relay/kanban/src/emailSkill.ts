// src/emailSkill.ts — prototype email skill (heuristic stand-in; replaced by Claude in production)

import type { Card } from './types';

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
