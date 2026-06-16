// src/users.ts — prototype user registry (replaced by SSO in production)

import type { User } from './types';

export const USERS: User[] = [
  { id: 'user-1', email: 'jay@sterlingx.com', name: 'Jay', avatarColor: '#6366f1' },
  { id: 'user-2', email: 'alex@sterlingx.com', name: 'Alex', avatarColor: '#10b981' },
  { id: 'user-3', email: 'morgan@sterlingx.com', name: 'Morgan', avatarColor: '#f59e0b' },
];

export function getUserById(id: string): User | undefined {
  return USERS.find((u) => u.id === id);
}
