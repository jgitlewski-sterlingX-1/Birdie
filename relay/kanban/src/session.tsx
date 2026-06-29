// src/session.tsx — current user session (Google OAuth)

import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import type { User } from './types';
import { apiFetch } from './apiClient';

const AVATAR_PALETTE = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#14b8a6','#ec4899','#84cc16'];

function avatarColorFromEmail(email: string): string {
  let h = 0;
  for (const c of email) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

interface AuthUser {
  id: string;
  email: string;
  name: string;
  domain: string;
}

interface SessionContextValue {
  authenticated: boolean;
  authUser: AuthUser | null;
  sessionId: string | null;
  currentUser: User;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Check for sessionId in URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('sessionId');

    if (sid) {
      // Verify session with backend
      apiFetch(`/api/auth/session?sessionId=${encodeURIComponent(sid)}`)
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

  // Derive the app User from the authenticated Google account. Falls back to a
  // placeholder before login so components that consume currentUser never crash.
  const currentUser = useMemo<User>(() => {
    if (authUser) {
      return {
        id: authUser.id,
        email: authUser.email,
        name: authUser.name,
        avatarColor: avatarColorFromEmail(authUser.email),
      };
    }
    return { id: '', email: '', name: '—', avatarColor: '#94a3b8' };
  }, [authUser]);

  const logout = () => {
    if (sessionId) {
      apiFetch('/api/auth/logout', {
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
