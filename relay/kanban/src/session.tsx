// src/session.tsx — current user session (prototype: user switcher; production: SSO)

import React, { createContext, useContext, useState } from 'react';
import type { User } from './types';
import { USERS } from './users';

interface SessionContextValue {
  currentUser: User;
  setCurrentUser: (user: User) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User>(USERS[0]);
  return (
    <SessionContext.Provider value={{ currentUser, setCurrentUser }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
