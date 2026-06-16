// src/approvalsStore.ts — useApprovals: append-only audit log backed by localStorage

import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { ApprovalLogEntry, Source } from './types';

const STORAGE_KEY = 'relay:approvals';

function load(): ApprovalLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ApprovalLogEntry[];
  } catch { /* ignore */ }
  return [];
}

function save(entries: ApprovalLogEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function useApprovals() {
  const [log, setLog] = useState<ApprovalLogEntry[]>(load);

  // Append-only — no update or delete
  const addEntry = useCallback(
    (params: {
      userId: string;
      cardId: string;
      cardTitle: string;
      source: Source;
      action: string;
      messagePreview: string;
      approvedById: string;
      approvedByName: string;
      externalRef?: string;
    }): string => {
      const entry: ApprovalLogEntry = {
        id: uuidv4(),
        approvedAt: new Date().toISOString(),
        ...params,
      };
      setLog((l) => {
        const next = [...l, entry];
        save(next);
        return next;
      });
      return entry.id;
    },
    []
  );

  return { log, addEntry };
}
