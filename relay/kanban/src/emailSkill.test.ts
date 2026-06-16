import { describe, expect, it } from 'vitest';
import { extractTodos, runEmailSkill, summarizeThread } from './emailSkill';
import type { Card } from './types';

describe('emailSkill', () => {
  it('summarizeThread returns prefixed summary with truncation', () => {
    const longBody = 'x'.repeat(140);
    const summary = summarizeThread([{ from: 'a@example.com', body: longBody }]);

    expect(summary.startsWith('[AI summary')).toBe(true);
    expect(summary.includes('…')).toBe(true);
  });

  it('extractTodos returns at most 3 actionable lines', () => {
    const todos = extractTodos([
      {
        body: [
          'Please review the complaint draft today.',
          'Can you confirm the filing deadline?',
          'Need you to send revised language.',
          'Please provide final sign-off.',
        ].join('\n'),
      },
    ]);

    expect(todos).toHaveLength(3);
    expect(todos[0].toLowerCase()).toContain('please review');
  });

  it('extractTodos falls back when no action phrase exists', () => {
    const todos = extractTodos([{ body: 'FYI: no action needed. Just informational.' }]);
    expect(todos).toEqual(['Review and respond to this email']);
  });

  it('runEmailSkill returns empty todos when card already extracted', () => {
    const card = {
      id: '1',
      title: 'Email task',
      source: 'gmail',
      completed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      summary: 'Existing summary',
      todosExtracted: true,
      emailThread: [{ from: 'a@example.com', date: new Date().toISOString(), body: 'Please review.' }],
    } as Card;

    const result = runEmailSkill(card);
    expect(result.summary).toBe('Existing summary');
    expect(result.todoTitles).toEqual([]);
  });

  it('runEmailSkill summarizes and extracts todos for fresh email cards', () => {
    const card = {
      id: '2',
      title: 'Fresh email task',
      source: 'gmail',
      completed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      emailThread: [
        {
          from: 'a@example.com',
          date: new Date().toISOString(),
          body: 'Could you review the demand letter and confirm edits by EOD?',
        },
      ],
    } as Card;

    const result = runEmailSkill(card);
    expect(result.summary.startsWith('[AI summary')).toBe(true);
    expect(result.todoTitles.length).toBeGreaterThan(0);
  });
});
