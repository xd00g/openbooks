import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<{ oidc: boolean; saml: boolean }>({
    oidc: false,
    saml: false,
  });

  useEffect(() => {
    api.get('/auth/providers').then(setProviders).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function sso() {
    const r = await api.get<{ authorizeUrl: string; tx: string }>('/auth/oidc/start');
    sessionStorage.setItem('oidc_tx', r.tx);
    window.location.href = r.authorizeUrl;
  }

  return (
    <div className="flex h-full items-center justify-center bg-paper px-4">
      <form onSubmit={submit} className="w-full max-w-sm border border-rule bg-white p-8">
        {/* The wordmark sits on the debit/credit seam that the whole app is
            built around — balanced, because a sign-in page has no books yet. */}
        <h1 className="font-display text-2xl font-semibold uppercase tracking-tight text-ink">OpenBooks</h1>
        <div className="mt-3 flex h-px w-full">
          <div className="h-px flex-1 bg-ink" />
          <div className="h-px flex-1 bg-rule" />
        </div>
        <p className="mb-7 mt-3 text-sm text-muted">Sign in to your books.</p>

        {error && (
          <div role="alert" className="mb-4 border-l-2 border-owed bg-owed/5 py-2 pl-3 text-sm text-owed">
            {error}
          </div>
        )}

        <label htmlFor="email" className="mb-1.5 block font-display text-eyebrow font-semibold uppercase text-muted">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded border border-rule bg-white px-3 py-2 text-sm focus:border-ink focus:outline-none"
          required
        />
        <label htmlFor="password" className="mb-1.5 block font-display text-eyebrow font-semibold uppercase text-muted">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-6 w-full rounded border border-rule bg-white px-3 py-2 text-sm focus:border-ink focus:outline-none"
          required
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-ink py-2.5 font-display text-eyebrow font-semibold uppercase text-white transition-opacity hover:opacity-85 disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {providers.oidc && (
          <button
            type="button"
            onClick={sso}
            className="mt-2 w-full rounded border border-rule py-2.5 font-display text-eyebrow font-semibold uppercase text-ink transition-colors hover:bg-ink hover:text-white"
          >
            Sign in with SSO
          </button>
        )}
      </form>
    </div>
  );
}
