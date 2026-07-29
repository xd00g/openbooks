/**
 * Tiny fetch wrapper. Attaches the session bearer token and the active
 * X-Company-Id to every request, and surfaces API error messages.
 */
const BASE = (import.meta as any).env?.VITE_API_URL || '/api';

const TOKEN_KEY = 'ob_token';
const COMPANY_KEY = 'ob_company';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export const companyStore = {
  get: () => localStorage.getItem(COMPANY_KEY),
  set: (id: string) => localStorage.setItem(COMPANY_KEY, id),
  clear: () => localStorage.removeItem(COMPANY_KEY),
};

async function request<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((opts.headers as Record<string, string>) || {}),
  };
  const token = tokenStore.get();
  if (token) headers['authorization'] = `Bearer ${token}`;
  const companyId = companyStore.get();
  if (companyId) headers['x-company-id'] = companyId;

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    tokenStore.clear();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = Array.isArray(body?.message)
      ? body.message.join(', ')
      : body?.message || res.statusText;
    throw new Error(msg);
  }
  return res.status === 204 ? (null as T) : res.json();
}

export const api = {
  get: <T = any>(p: string) => request<T>(p),
  post: <T = any>(p: string, body?: unknown) =>
    request<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T = any>(p: string, body?: unknown) =>
    request<T>(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T = any>(p: string, body?: unknown) =>
    request<T>(p, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T = any>(p: string) => request<T>(p, { method: 'DELETE' }),
  /** Fetch a binary response (e.g. a PDF) with auth and return an object URL. */
  blobUrl: async (p: string): Promise<string> => {
    const headers: Record<string, string> = {};
    const token = tokenStore.get();
    if (token) headers['authorization'] = `Bearer ${token}`;
    const companyId = companyStore.get();
    if (companyId) headers['x-company-id'] = companyId;
    const res = await fetch(`${BASE}${p}`, { headers });
    if (!res.ok) throw new Error('Failed to load file.');
    return URL.createObjectURL(await res.blob());
  },
};
