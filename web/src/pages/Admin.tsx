import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { Page, Card, Table, Button, Empty } from '../components/ui';

const PERMISSIONS = [
  '*',
  'company:manage',
  'user:manage',
  'system:manage',
  'account:manage',
  'invoice:create',
  'bill:create',
  'payment:create',
  'banking:manage',
  'banking:reconcile',
  'payroll:manage',
  'payroll:run',
  'report:view',
];

type Tab = 'members' | 'roles' | 'audit' | 'system';

export default function Admin() {
  const { companyId, can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('members');
  const [err, setErr] = useState('');
  const key = (k: string) => [k, companyId];

  const members = useQuery({ queryKey: key('members'), enabled: !!companyId && can('user:manage'), queryFn: () => api.get('/admin/members') });
  const roles = useQuery({ queryKey: key('roles'), enabled: !!companyId && can('user:manage'), queryFn: () => api.get('/admin/roles') });
  const audit = useQuery({ queryKey: key('audit'), enabled: !!companyId && can('user:manage') && tab === 'audit', queryFn: () => api.get('/admin/audit') });

  const [member, setMember] = useState({ email: '', roleId: '', fullName: '', password: '' });
  const addMember = useMutation({
    mutationFn: () => api.post('/admin/members', member),
    onSuccess: () => { setMember({ email: '', roleId: '', fullName: '', password: '' }); qc.invalidateQueries({ queryKey: key('members') }); },
    onError: (e: any) => setErr(e.message),
  });
  const setRole = (userId: string, roleId: string) =>
    api.patch(`/admin/members/${userId}`, { roleId }).then(() => qc.invalidateQueries({ queryKey: key('members') })).catch((e) => setErr(e.message));

  const [role, setRole2] = useState<{ name: string; permissions: string[] }>({ name: '', permissions: [] });
  const togglePerm = (p: string) =>
    setRole2((r) => ({ ...r, permissions: r.permissions.includes(p) ? r.permissions.filter((x) => x !== p) : [...r.permissions, p] }));
  const createRole = useMutation({
    mutationFn: () => api.post('/admin/roles', role),
    onSuccess: () => { setRole2({ name: '', permissions: [] }); qc.invalidateQueries({ queryKey: key('roles') }); },
    onError: (e: any) => setErr(e.message),
  });

  if (!companyId) return <Page title="Admin"><Empty>Select a company.</Empty></Page>;
  if (!can('user:manage')) return <Page title="Admin"><Empty>You need the <code>user:manage</code> permission to administer this company.</Empty></Page>;

  return (
    <Page title="Admin">
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <div className="mb-4 flex gap-2">
        {(['members', 'roles', 'audit', ...(can('system:manage') ? ['system'] : [])] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${tab === t ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{t}</button>
        ))}
      </div>

      {tab === 'members' && (
        <>
          <Card title="Add member">
            <div className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
              <input value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} placeholder="email" className="rounded-md border border-slate-300 px-2 py-1" />
              <select value={member.roleId} onChange={(e) => setMember({ ...member, roleId: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1">
                <option value="">Role…</option>
                {(roles.data ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <input value={member.fullName} onChange={(e) => setMember({ ...member, fullName: e.target.value })} placeholder="Full name (new user)" className="rounded-md border border-slate-300 px-2 py-1" />
              <input value={member.password} onChange={(e) => setMember({ ...member, password: e.target.value })} placeholder="Temp password (new local user)" className="rounded-md border border-slate-300 px-2 py-1" />
            </div>
            <div className="mt-3"><Button onClick={() => addMember.mutate()} disabled={!member.email || !member.roleId}>Add / update member</Button></div>
            <p className="mt-2 text-xs text-slate-400">Existing users (or SSO users who've signed in) are linked by email. Provide a temp password to create a new local user.</p>
          </Card>
          <div className="mt-4">
            <Table head={['Email', 'Name', 'Role', 'Auth', 'Active']}>
              {(members.data ?? []).map((m: any) => (
                <tr key={m.user.id}>
                  <td className="px-4 py-2 font-medium">{m.user.email}</td>
                  <td className="px-4 py-2">{m.user.fullName || '—'}</td>
                  <td className="px-4 py-2">
                    <select value={m.role.id} onChange={(e) => setRole(m.user.id, e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                      {(roles.data ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{m.user.authProvider}</td>
                  <td className="px-4 py-2">{m.user.isActive ? '✓' : '—'}</td>
                </tr>
              ))}
              {(members.data ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No members.</td></tr>}
            </Table>
          </div>
        </>
      )}

      {tab === 'roles' && (
        <>
          <Card title="Create role">
            <input value={role.name} onChange={(e) => setRole2({ ...role, name: e.target.value })} placeholder="Role name" className="mb-3 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <div className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
              {PERMISSIONS.map((p) => (
                <label key={p} className="flex items-center gap-2">
                  <input type="checkbox" checked={role.permissions.includes(p)} onChange={() => togglePerm(p)} />
                  <code className="text-xs">{p}</code>
                </label>
              ))}
            </div>
            <div className="mt-3"><Button onClick={() => createRole.mutate()} disabled={!role.name || role.permissions.length === 0}>Create role</Button></div>
          </Card>
          <div className="mt-4">
            <Table head={['Role', 'Permissions', 'Scope']}>
              {(roles.data ?? []).map((r: any) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{r.permissions.join(', ')}</td>
                  <td className="px-4 py-2 text-slate-500">{r.organizationId ? 'Organization' : 'System template'}</td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}

      {tab === 'audit' && (
        <Table head={['When', 'Actor', 'Action', 'Table', 'Record']}>
          {(audit.data ?? []).map((a: any) => (
            <tr key={a.id}>
              <td className="px-4 py-2">{date(a.createdAt)}</td>
              <td className="px-4 py-2 text-slate-500">{a.actorUserId || '—'}</td>
              <td className="px-4 py-2">{a.action}</td>
              <td className="px-4 py-2">{a.tableName}</td>
              <td className="px-4 py-2 text-slate-500">{a.recordId || '—'}</td>
            </tr>
          ))}
          {(audit.data ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No audit entries yet.</td></tr>}
        </Table>
      )}

      {tab === 'system' && <SystemSettings onError={setErr} />}
    </Page>
  );
}

function SystemSettings({ onError }: { onError: (m: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system-settings'], queryFn: () => api.get('/system/settings') });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['system-settings'] });

  if (q.isLoading) return <div className="text-sm text-slate-400">Loading…</div>;
  if (q.error) return <div className="text-sm text-red-600">{(q.error as Error).message}</div>;
  const d = q.data;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Deployment-level settings. These apply to the whole OpenBooks instance, not a single company.
        Environment variables still act as the fallback for any field left blank here.
      </p>
      <OidcCard data={d.oidc} onSaved={invalidate} onError={onError} />
      <SamlCard data={d.saml} onSaved={invalidate} onError={onError} />
      <SmtpCard data={d.smtp} onSaved={invalidate} onError={onError} />
    </div>
  );
}

const inp = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
function Field({ label, children }: { label: string; children: any }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
function StatusPill({ ok }: { ok: boolean }) {
  return <span className={`text-xs font-medium ${ok ? 'text-emerald-600' : 'text-slate-400'}`}>{ok ? '● Configured' : '○ Not configured'}</span>;
}

function OidcCard({ data, onSaved, onError }: { data: any; onSaved: () => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ issuerUrl: data.issuerUrl ?? '', clientId: data.clientId ?? '', redirectUri: data.redirectUri ?? '', clientSecret: '' });
  const save = useMutation({ mutationFn: () => api.put('/system/settings/oidc', f), onSuccess: onSaved, onError: (e: any) => onError(e.message) });
  return (
    <Card title="OIDC single sign-on">
      <div className="mb-3"><StatusPill ok={data.configured} /></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Issuer URL"><input className={inp} value={f.issuerUrl} onChange={(e) => setF({ ...f, issuerUrl: e.target.value })} placeholder="https://idp.example.com" /></Field>
        <Field label="Client ID"><input className={inp} value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} /></Field>
        <Field label="Redirect URI"><input className={inp} value={f.redirectUri} onChange={(e) => setF({ ...f, redirectUri: e.target.value })} placeholder="https://books.example.com" /></Field>
        <Field label={`Client secret ${data.hasClientSecret ? '(set — leave blank to keep)' : ''}`}><input type="password" className={inp} value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} placeholder={data.hasClientSecret ? '••••••••' : ''} /></Field>
      </div>
      <div className="mt-3"><Button onClick={() => save.mutate()}>Save OIDC</Button></div>
    </Card>
  );
}

function SamlCard({ data, onSaved, onError }: { data: any; onSaved: () => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ entryPoint: data.entryPoint ?? '', issuer: data.issuer ?? 'openbooks', callbackUrl: data.callbackUrl ?? '', cert: '' });
  const save = useMutation({ mutationFn: () => api.put('/system/settings/saml', f), onSuccess: onSaved, onError: (e: any) => onError(e.message) });
  return (
    <Card title="SAML single sign-on">
      <div className="mb-3"><StatusPill ok={data.configured} /></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="IdP entry point (SSO URL)"><input className={inp} value={f.entryPoint} onChange={(e) => setF({ ...f, entryPoint: e.target.value })} /></Field>
        <Field label="SP issuer / entity ID"><input className={inp} value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></Field>
        <Field label="Callback URL"><input className={inp} value={f.callbackUrl} onChange={(e) => setF({ ...f, callbackUrl: e.target.value })} /></Field>
        <Field label={`IdP signing certificate (PEM) ${data.hasCert ? '(set — leave blank to keep)' : ''}`}><textarea className={`${inp} h-20 font-mono text-xs`} value={f.cert} onChange={(e) => setF({ ...f, cert: e.target.value })} placeholder={data.hasCert ? '•••••• (certificate stored)' : '-----BEGIN CERTIFICATE-----'} /></Field>
      </div>
      <div className="mt-3"><Button onClick={() => save.mutate()}>Save SAML</Button></div>
    </Card>
  );
}

function SmtpCard({ data, onSaved, onError }: { data: any; onSaved: () => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ host: data.host ?? '', port: data.port ?? 587, secure: !!data.secure, username: data.username ?? '', fromEmail: data.fromEmail ?? '', fromName: data.fromName ?? 'OpenBooks', password: '' });
  const [testTo, setTestTo] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const save = useMutation({ mutationFn: () => api.put('/system/settings/smtp', f), onSuccess: onSaved, onError: (e: any) => onError(e.message) });
  const test = useMutation({
    mutationFn: () => api.post('/system/settings/smtp/test', { to: testTo }),
    onSuccess: () => setTestMsg('Test email sent ✓'),
    onError: (e: any) => { setTestMsg(''); onError(e.message); },
  });
  return (
    <Card title="SMTP (outbound email)">
      <div className="mb-3"><StatusPill ok={data.configured} /></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Host"><input className={inp} value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="smtp.example.com" /></Field>
        <Field label="Port"><input type="number" className={inp} value={f.port} onChange={(e) => setF({ ...f, port: Number(e.target.value) })} /></Field>
        <Field label="Username"><input className={inp} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label={`Password ${data.hasPassword ? '(set — leave blank to keep)' : ''}`}><input type="password" className={inp} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={data.hasPassword ? '••••••••' : ''} /></Field>
        <Field label="From email"><input className={inp} value={f.fromEmail} onChange={(e) => setF({ ...f, fromEmail: e.target.value })} placeholder="noreply@example.com" /></Field>
        <Field label="From name"><input className={inp} value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} /></Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} /> Use TLS (secure) connection
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => save.mutate()}>Save SMTP</Button>
        <span className="mx-2 text-slate-300">|</span>
        <input className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
        <Button variant="ghost" onClick={() => test.mutate()} disabled={!testTo.trim() || test.isPending}>{test.isPending ? 'Sending…' : 'Send test'}</Button>
        {testMsg && <span className="text-sm text-emerald-600">{testMsg}</span>}
      </div>
    </Card>
  );
}
