// src/emailGroupsStore.ts — useEmailGroups: per-user email address groups + classifications + ignore rules, localStorage-backed

import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { EmailGroup, EmailAddressClassification, EmailRule } from './types';

const GROUPS_KEY = 'relay:email-groups';
const CLASSIFICATIONS_KEY = 'relay:email-classifications';
const RULES_KEY = 'relay:email-rules';

export const GROUP_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#0ea5e9', // sky
  '#f97316', // orange
];

function loadGroups(): EmailGroup[] {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (raw) return JSON.parse(raw) as EmailGroup[];
  } catch { /* ignore */ }
  return [];
}

function saveGroups(groups: EmailGroup[]) {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
}

function loadClassifications(): Record<string, EmailAddressClassification> {
  try {
    const raw = localStorage.getItem(CLASSIFICATIONS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, EmailAddressClassification>;
  } catch { /* ignore */ }
  return {};
}

function saveClassifications(cls: Record<string, EmailAddressClassification>) {
  localStorage.setItem(CLASSIFICATIONS_KEY, JSON.stringify(cls));
}

function loadRules(): EmailRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (raw) return JSON.parse(raw) as EmailRule[];
  } catch { /* ignore */ }
  return [];
}

function saveRules(rules: EmailRule[]) {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

// Pure utility — call anywhere (ingest pipeline, tests) without the hook.
export function checkEmailRules(
  params: { from: string; subject: string },
  rules: EmailRule[]
): EmailRule | null {
  const from = params.from.toLowerCase();
  const subject = params.subject.toLowerCase();
  const domainMatch = from.match(/@([^>]+)$/)
  const domain = domainMatch ? domainMatch[1] : '';

  for (const rule of rules) {
    const { field, operator, value } = rule.condition;
    const v = value.toLowerCase();
    let target = '';
    if (field === 'from') target = from;
    else if (field === 'domain') target = domain;
    else if (field === 'subject') target = subject;

    const match = operator === 'contains' ? target.includes(v) : target === v;
    if (match) return rule;
  }
  return null;
}

export function useEmailGroups() {
  const [groups, setGroups] = useState<EmailGroup[]>(loadGroups);
  const [classifications, setClassifications] = useState<
    Record<string, EmailAddressClassification>
  >(loadClassifications);
  const [rules, setRules] = useState<EmailRule[]>(loadRules);

  const addGroup = useCallback((name: string, color?: string): string => {
    const group: EmailGroup = {
      id: uuidv4(),
      name,
      color: color ?? GROUP_COLORS[0],
      createdAt: new Date().toISOString(),
    };
    setGroups((gs) => {
      const next = [...gs, group];
      saveGroups(next);
      return next;
    });
    return group.id;
  }, []);

  const updateGroup = useCallback((id: string, patch: Partial<EmailGroup>) => {
    setGroups((gs) => {
      const next = gs.map((g) => (g.id === id ? { ...g, ...patch } : g));
      saveGroups(next);
      return next;
    });
  }, []);

  const deleteGroup = useCallback((id: string) => {
    setGroups((gs) => {
      const next = gs.filter((g) => g.id !== id);
      saveGroups(next);
      return next;
    });
    // Unclassify all addresses that were in this group
    setClassifications((cls) => {
      const now = new Date().toISOString();
      let changed = false;
      const next = { ...cls };
      for (const key of Object.keys(next)) {
        if (next[key].groupId === id) {
          next[key] = { ...next[key], groupId: null, updatedAt: now };
          changed = true;
        }
      }
      if (changed) saveClassifications(next);
      return changed ? next : cls;
    });
  }, []);

  const classify = useCallback(
    (email: string, displayName: string | undefined, groupId: string | null) => {
      const key = email.toLowerCase();
      setClassifications((cls) => {
        const next = {
          ...cls,
          [key]: {
            email: key,
            displayName: displayName || cls[key]?.displayName,
            groupId,
            updatedAt: new Date().toISOString(),
          },
        };
        saveClassifications(next);
        return next;
      });
    },
    []
  );

  const addRule = useCallback(
    (condition: EmailRule['condition'], note?: string): EmailRule => {
      const rule: EmailRule = {
        id: uuidv4(),
        condition,
        action: 'ignore',
        note,
        createdAt: new Date().toISOString(),
      };
      setRules((rs) => {
        const next = [...rs, rule];
        saveRules(next);
        return next;
      });
      return rule;
    },
    []
  );

  const deleteRule = useCallback((id: string) => {
    setRules((rs) => {
      const next = rs.filter((r) => r.id !== id);
      saveRules(next);
      return next;
    });
  }, []);

  return { groups, classifications, rules, addGroup, updateGroup, deleteGroup, classify, addRule, deleteRule, GROUP_COLORS };
}
