import { describe, expect, it, vi } from 'vitest';
import { apiFetch, buildApiUrl, normalizeApiBaseUrl } from './apiClient';

describe('apiClient', () => {
  it('normalizeApiBaseUrl trims trailing slash', () => {
    expect(normalizeApiBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(normalizeApiBaseUrl('https://api.example.com')).toBe('https://api.example.com');
  });

  it('buildApiUrl joins base and path', () => {
    expect(buildApiUrl('/api/auth/login', 'https://api.example.com/')).toBe(
      'https://api.example.com/api/auth/login'
    );
    expect(buildApiUrl('/api/auth/login', '')).toBe('/api/auth/login');
  });

  it('buildApiUrl throws when path is not rooted', () => {
    expect(() => buildApiUrl('api/auth/login', 'https://api.example.com')).toThrow(
      "API path must start with '/'"
    );
  });

  it('apiFetch delegates to fetch with built URL', async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await apiFetch('/api/integrations', { method: 'GET' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/integrations', { method: 'GET' });
    fetchSpy.mockRestore();
  });
});
