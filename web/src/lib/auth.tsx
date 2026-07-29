import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, companyStore, tokenStore } from './api';

export interface Membership {
  companyId: string;
  company: string;
  role: string;
  permissions: string[];
}
interface Me {
  user: { id: string; email: string; fullName?: string; isSystemAdmin: boolean };
  memberships: Membership[];
}

interface AuthState {
  loading: boolean;
  me: Me | null;
  companyId: string | null;
  setCompany: (id: string) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  can: (perm: string) => boolean;
}

const Ctx = createContext<AuthState>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(companyStore.get());

  async function loadMe() {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    try {
      const data = await api.get<Me>('/auth/me');
      setMe(data);
      if (!companyStore.get() && data.memberships[0]) {
        companyStore.set(data.memberships[0].companyId);
        setCompanyId(data.memberships[0].companyId);
      }
    } catch {
      tokenStore.clear();
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Handle an OIDC redirect back (?code=&state=); tx was stashed at start.
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const tx = sessionStorage.getItem('oidc_tx');
    if (code && state && tx) {
      api
        .get(
          `/auth/oidc/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(
            state,
          )}&tx=${encodeURIComponent(tx)}`,
        )
        .then((r: any) => {
          tokenStore.set(r.token);
          sessionStorage.removeItem('oidc_tx');
          window.history.replaceState({}, '', window.location.pathname);
          return loadMe();
        })
        .catch(() => setLoading(false));
      return;
    }
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      me,
      companyId,
      setCompany: (id: string) => {
        companyStore.set(id);
        setCompanyId(id);
      },
      login: async (email, password) => {
        const r = await api.post<{ token: string }>('/auth/login', { email, password });
        tokenStore.set(r.token);
        await loadMe();
      },
      logout: () => {
        tokenStore.clear();
        companyStore.clear();
        setMe(null);
        setCompanyId(null);
      },
      refresh: async () => {
        await loadMe();
      },
      can: (perm: string) => {
        const m = me?.memberships.find((x) => x.companyId === companyId);
        if (me?.user.isSystemAdmin) return true;
        if (!m) return false;
        if (m.permissions.includes('*')) return true;
        if (m.permissions.includes(perm)) return true;
        const [resource] = perm.split(':');
        return m.permissions.includes(`${resource}:*`);
      },
    }),
    [loading, me, companyId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
