// src/sources.ts — source metadata registry

import type { Source } from './types';

export const SOURCES: Record<Source, { label: string; color: string; bg: string }> = {
  gmail: { label: 'Gmail', color: '#dc2626', bg: '#fef2f2' },
  slack: { label: 'Slack', color: '#7c3aed', bg: '#f5f3ff' },
  salesforce: { label: 'Salesforce', color: '#0284c7', bg: '#f0f9ff' },
  user: { label: 'Manual', color: '#64748b', bg: '#f8fafc' },
};
