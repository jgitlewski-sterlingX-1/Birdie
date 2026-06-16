// src/projectsStore.ts — useProjects: project state backed by localStorage

import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Project } from './types';

const STORAGE_KEY = 'relay:projects';

const PROJECT_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
];

function load(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Project[];
  } catch { /* ignore */ }
  return [];
}

function save(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>(load);

  const addProject = useCallback((name: string, description?: string): string => {
    const project: Project = {
      id: uuidv4(),
      name,
      description,
      color: PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)],
      createdAt: new Date().toISOString(),
    };
    setProjects((ps) => {
      const next = [...ps, project];
      save(next);
      return next;
    });
    return project.id;
  }, []);

  const updateProject = useCallback((id: string, patch: Partial<Project>) => {
    setProjects((ps) => {
      const next = ps.map((p) => (p.id === id ? { ...p, ...patch } : p));
      save(next);
      return next;
    });
  }, []);

  const deleteProject = useCallback((id: string) => {
    setProjects((ps) => {
      const next = ps.filter((p) => p.id !== id);
      save(next);
      return next;
    });
  }, []);

  const getProjectById = useCallback(
    (id: string) => projects.find((p) => p.id === id),
    [projects]
  );

  return { projects, addProject, updateProject, deleteProject, getProjectById };
}
