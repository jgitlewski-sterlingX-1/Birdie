import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { AgentId, AgentConfig, AgentFilter } from './types';
import { AGENTS } from './agents';

const STORAGE_KEY = 'relay:agents';

function defaultConfig(agentId: AgentId): AgentConfig {
  return {
    agentId,
    enabled: true,
    instructions: '',
    filters: [],
    updatedAt: new Date().toISOString(),
  };
}

function load(): AgentConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AgentConfig[];
  } catch { /* ignore */ }
  return [];
}

function save(configs: AgentConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

export function useAgents() {
  const [configs, setConfigs] = useState<AgentConfig[]>(() => {
    const stored = load();
    return AGENTS.map((a) => stored.find((c) => c.agentId === a.id) ?? defaultConfig(a.id));
  });

  const getConfig = useCallback(
    (agentId: AgentId): AgentConfig =>
      configs.find((c) => c.agentId === agentId) ?? defaultConfig(agentId),
    [configs]
  );

  const patchConfig = useCallback((agentId: AgentId, patch: Partial<AgentConfig>) => {
    setConfigs((prev) => {
      const next = prev.map((c) =>
        c.agentId === agentId
          ? { ...c, ...patch, updatedAt: new Date().toISOString() }
          : c
      );
      save(next);
      return next;
    });
  }, []);

  const toggleAgent = useCallback(
    (agentId: AgentId) => {
      const current = configs.find((c) => c.agentId === agentId);
      patchConfig(agentId, { enabled: !(current?.enabled ?? true) });
    },
    [configs, patchConfig]
  );

  const setInstructions = useCallback(
    (agentId: AgentId, instructions: string) => {
      patchConfig(agentId, { instructions });
    },
    [patchConfig]
  );

  const addFilter = useCallback(
    (agentId: AgentId, filter: Omit<AgentFilter, 'id'>) => {
      const config = configs.find((c) => c.agentId === agentId) ?? defaultConfig(agentId);
      patchConfig(agentId, {
        filters: [...config.filters, { ...filter, id: uuidv4() }],
      });
    },
    [configs, patchConfig]
  );

  const removeFilter = useCallback(
    (agentId: AgentId, filterId: string) => {
      const config = configs.find((c) => c.agentId === agentId) ?? defaultConfig(agentId);
      patchConfig(agentId, {
        filters: config.filters.filter((f) => f.id !== filterId),
      });
    },
    [configs, patchConfig]
  );

  return { configs, getConfig, toggleAgent, setInstructions, addFilter, removeFilter };
}
