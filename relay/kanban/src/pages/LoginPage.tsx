// src/pages/LoginPage.tsx — OAuth login page

import { useState } from 'react';
import '../App.css';

export function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login');
      const data = await response.json();

      if (data.authUrl) {
        // Redirect to Google OAuth consent screen
        window.location.href = data.authUrl;
      } else {
        setError(data.error || 'Failed to initiate login');
      }
    } catch (err) {
      setError('Failed to connect to server. Is the API running?');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <h1>Relay</h1>
          <p className="login-subtitle">
            AI-powered email triage workspace for rocketclicks & Sterling Lawyers
          </p>

          <button
            className="login-button"
            onClick={handleSignIn}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign in with Google'}
          </button>

          {error && <p className="login-error">{error}</p>}

          <p className="login-help">
            Sign in with your @rocketclicks.com or @sterlinglawyers.com email
          </p>
        </div>
      </div>
    </div>
  );
}
