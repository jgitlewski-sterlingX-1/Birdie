// src/session.tsx — current user session (OAuth + mock user selector)

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { User } from './types';
import { USERS } from './users';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  domain: string;
}

interface SessionContextValue {
  // Authentication
  authenticated: boolean;
  authUser: AuthUser | null;
  sessionId: string | null;
  
  // Mock user selector (for non-authenticated users)
  currentUser: User;
  setCurrentUser: (user: User) => void;
  
  // Auth methods
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User>(USERS[0]);

  // Check for sessionId in URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('sessionId');

    if (sid) {
      // Verify session with backend
      fetch(`/api/auth/session?sessionId=${sid}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.authenticated && data.user) {
            setSessionId(sid);
            setAuthUser(data.user);
            setAuthenticated(true);
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        })
        .catch((err) => console.error('[Session] Failed to verify session:', err));
    }
  }, []);

  const logout = () => {
    if (sessionId) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch((err) => console.error('[Session] Logout failed:', err));
    }
    setAuthenticated(false);
    setAuthUser(null);
    setSessionId(null);
  };

  return (
    <SessionContext.Provider
      value={{
        authenticated,
        authUser,
        sessionId,
        currentUser,
        setCurrentUser,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
