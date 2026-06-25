import type { AgentId, FilterField } from './types';

export interface AgentStep {
  label: string;
  detail?: string;
  requiresApproval?: boolean;
}

export interface AgentDefinition {
  id: AgentId;
  name: string;
  icon: string;
  tagline: string;
  integration: string | null;
  trigger: string;
  steps: AgentStep[];
  filterFields: { value: FilterField; label: string }[];
  comingSoon?: boolean;
}

export const AGENTS: AgentDefinition[] = [
  {
    id: 'email',
    name: 'Email Agent',
    icon: '📬',
    tagline: 'Monitors your inbox and turns messages into actionable cards.',
    integration: 'gmail',
    trigger: 'A new email arrives in your inbox',
    steps: [
      { label: 'Classify the email', detail: 'Action needed, FYI, or Noise' },
      { label: 'Summarize key points and extract action items' },
      { label: 'Create a card on your board' },
      {
        label: 'Draft a reply in your voice',
        detail: 'Only on Action needed items',
        requiresApproval: true,
      },
    ],
    filterFields: [
      { value: 'from', label: 'Sender' },
      { value: 'domain', label: 'Sender domain' },
      { value: 'subject', label: 'Subject line' },
      { value: 'keyword', label: 'Keyword (anywhere in message)' },
    ],
  },
  {
    id: 'slack',
    name: 'Slack Agent',
    icon: '💬',
    tagline: 'Monitors Slack for messages that need your attention.',
    integration: 'slack',
    trigger: 'A Slack message mentions you or a keyword you follow',
    steps: [
      { label: 'Classify the message', detail: 'Urgent, FYI, or Noise' },
      { label: 'Summarize and identify any asks' },
      { label: 'Create a card on your board' },
      { label: 'Draft a Slack reply', requiresApproval: true },
    ],
    filterFields: [
      { value: 'from', label: 'Sender' },
      { value: 'keyword', label: 'Keyword' },
    ],
  },
  {
    id: 'calendar',
    name: 'Calendar Agent',
    icon: '📅',
    tagline: 'Prepares briefings before meetings and captures follow-ups after.',
    integration: 'calendar',
    trigger: 'A meeting is coming up or has just ended',
    steps: [
      { label: 'Pull context about attendees and the meeting topic' },
      { label: 'Create a prep card with key talking points' },
      { label: 'After the meeting, capture follow-up action items', requiresApproval: true },
    ],
    filterFields: [{ value: 'keyword', label: 'Meeting title keyword' }],
    comingSoon: true,
  },
  {
    id: 'coordinator',
    name: 'Coordinator',
    icon: '🧭',
    tagline: 'Routes work across agents and escalates decisions that need your attention.',
    integration: null,
    trigger: 'An agent surfaces a card that spans multiple workstreams',
    steps: [
      { label: 'Identify cards that need cross-agent handling' },
      { label: 'Route to the right agent or escalate to you' },
      { label: 'Summarize what happened and why', requiresApproval: true },
    ],
    filterFields: [],
    comingSoon: true,
  },
];
