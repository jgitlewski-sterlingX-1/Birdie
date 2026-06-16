// src/priorities.ts — priority metadata registry

import type { Priority } from './types';

export const PRIORITIES: Record<Priority, { label: string; color: string; bg: string }> = {
  high: { label: 'High', color: '#dc2626', bg: '#fef2f2' },
  medium: { label: 'Medium', color: '#d97706', bg: '#fffbeb' },
  low: { label: 'Low', color: '#16a34a', bg: '#f0fdf4' },
};
