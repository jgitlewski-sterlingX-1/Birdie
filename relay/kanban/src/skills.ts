// src/skills.ts — base skill definitions (read-only; custom skills in skillsStore)

import type { Skill } from './types';

export const BASE_SKILLS: Skill[] = [
  {
    id: 'base-email-triage',
    name: 'Email Triage',
    category: 'email',
    kind: 'base',
    description: 'Classifies incoming emails and extracts action items.',
    instructions:
      'Classify the email thread as ACTION_NEEDED, FYI, or NOISE. ' +
      'For ACTION_NEEDED items: extract a concise title, write a 2-3 sentence summary, ' +
      'and list specific action items requested of the recipient as subtasks. ' +
      'Extract client name/company if determinable from context. ' +
      'Set priority based on urgency signals (deadlines, escalation language, VIP senders).',
    enabled: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'base-email-voice',
    name: 'Reply Voice',
    category: 'email',
    kind: 'base',
    description: "Drafts email replies in the user's voice.",
    instructions:
      'Draft replies that sound like the user: warm but professional, concise, ' +
      'and direct. Open by acknowledging the sender, address each request in the ' +
      'thread, and close with a clear next step. Avoid filler, hedging, and legalese ' +
      'unless the thread calls for it. Keep it to a few short paragraphs. ' +
      'This is a default voice — refine it with a custom skill to match the user exactly.',
    enabled: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'base-slack-triage',
    name: 'Slack Triage',
    category: 'slack',
    kind: 'base',
    description: 'Classifies Slack messages that mention or involve the user.',
    instructions:
      'Classify the Slack message/thread as ACTION_NEEDED, FYI, or NOISE. ' +
      'For ACTION_NEEDED: extract a concise title and the specific action requested. ' +
      'Ignore casual mentions and general announcements (FYI/NOISE). ' +
      'Flag time-sensitive items with high priority.',
    enabled: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'base-salesforce-triage',
    name: 'Salesforce Task Triage',
    category: 'salesforce',
    kind: 'base',
    description: 'Classifies and summarizes Salesforce tasks assigned to the user.',
    instructions:
      'Classify the Salesforce task as ACTION_NEEDED or NOISE. ' +
      'Extract the task title, due date, and associated client/matter. ' +
      'All assigned tasks are generally ACTION_NEEDED unless they are auto-generated system tasks.',
    enabled: true,
    updatedAt: new Date().toISOString(),
  },
];
