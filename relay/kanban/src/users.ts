// src/users.ts — no hardcoded users; all users come from the Google Workspace
// directory via GET /api/directory/users at login time.

import type { User } from './types';

export const USERS: User[] = [];

export function getUserById(id: string): User | undefined {
  return USERS.find((u) => u.id === id);
}
