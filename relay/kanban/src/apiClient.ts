const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();

export function normalizeApiBaseUrl(value: string): string {
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

const apiBaseUrl = normalizeApiBaseUrl(rawApiBaseUrl);

export function buildApiUrl(path: string, baseUrl = apiBaseUrl): string {
  if (!path.startsWith('/')) {
    throw new Error(`API path must start with '/': ${path}`);
  }
  return `${normalizeApiBaseUrl(baseUrl)}${path}`;
}

export function apiUrl(path: string): string {
  return buildApiUrl(path, apiBaseUrl);
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init);
}
