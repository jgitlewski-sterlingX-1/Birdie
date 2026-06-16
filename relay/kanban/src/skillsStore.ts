// src/skillsStore.ts — useSkills: custom skill state backed by localStorage

import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Skill, SkillCategory } from './types';
import { BASE_SKILLS } from './skills';

const STORAGE_KEY = 'relay:skills';

function loadCustom(): Skill[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Skill[];
  } catch { /* ignore */ }
  return [];
}

function saveCustom(skills: Skill[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(skills));
}

export function useSkills() {
  const [customSkills, setCustomSkills] = useState<Skill[]>(loadCustom);

  // Base skills are read-only; custom skills are user-owned
  const allSkills = [...BASE_SKILLS, ...customSkills];

  const addSkill = useCallback(
    (
      name: string,
      category: SkillCategory,
      description: string,
      instructions: string,
      userId: string
    ): string => {
      const skill: Skill = {
        id: uuidv4(),
        userId,
        name,
        category,
        kind: 'custom',
        description,
        instructions,
        enabled: true,
        updatedAt: new Date().toISOString(),
      };
      setCustomSkills((cs) => {
        const next = [...cs, skill];
        saveCustom(next);
        return next;
      });
      return skill.id;
    },
    []
  );

  const updateSkill = useCallback((id: string, patch: Partial<Skill>) => {
    setCustomSkills((cs) => {
      const next = cs.map((s) =>
        s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s
      );
      saveCustom(next);
      return next;
    });
  }, []);

  const deleteSkill = useCallback((id: string) => {
    setCustomSkills((cs) => {
      const next = cs.filter((s) => s.id !== id);
      saveCustom(next);
      return next;
    });
  }, []);

  const toggleSkill = useCallback((id: string) => {
    setCustomSkills((cs) => {
      const next = cs.map((s) =>
        s.id === id
          ? { ...s, enabled: !s.enabled, updatedAt: new Date().toISOString() }
          : s
      );
      saveCustom(next);
      return next;
    });
  }, []);

  return {
    allSkills,
    baseSkills: BASE_SKILLS,
    customSkills,
    addSkill,
    updateSkill,
    deleteSkill,
    toggleSkill,
  };
}
