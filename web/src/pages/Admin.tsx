import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { Page, Card, Table, Button, Empty, Modal, Banner } from '../components/ui';
import RoleMatrix from '../components/RoleMatrix';

type Tab = 'members' | 'users' | 'companies' | 'roles' | 'audit' | 'system';

function AddMemberRow({ companyId, users, roles, onAdd }: { companyId: string; users: any[]; roles: any[]; onAdd: (u: string, c: string, r: string) => void }) {
  const [u, setU] = useState('');
  const [r, setR] = useState('');
  return (
    <div className="mt-2 flex items-center gap-2 text-sm">
      <select value={u} onChange={(e) => setU(e.target.value)} className="rounded-md border border-rule px-2 py-1">
        <option value="">Add user…</option>
        {users.map((x) => <option key={x.id} value={x.id}>{x.email}</option>)}
      </select>
      <select value={r} onChange={(e) => setR(e.target.value)} className="rounded-md border border-rule px-2 py-1">
        <option value="">Role…</option>
        {roles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <Button onClick={() => { if (u && r) { onAdd(u, companyId, r); setU(''); setR(''); } }} disabled={!u || !r}>Add</Button>
    </div>
  );
}

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

  // ---- Organization-wide (cross-company) management ----
  const orgUsers = useQuery({ queryKey: key('org-users'), enabled: !!companyId && can('user:manage') && (tab === 'users' || tab === 'companies'), queryFn: () => api.get('/admin/org/users') });
  const orgCompanies = useQuery({ queryKey: key('org-companies'), enabled: !!companyId && can('user:manage') && (tab === 'users' || tab === 'companies'), queryFn: () => api.get('/admin/org/companies') });
  const orgRoles = useQuery({ queryKey: key('org-roles'), enabled: !!companyId && can('user:manage'), queryFn: () => api.get('/admin/org/roles') });
  const invalidateOrg = () => { qc.invalidateQueries({ queryKey: key('org-users') }); qc.invalidateQueries({ queryKey: key('org-companies') }); };

  const [newUser, setNewUser] = useState({ email: '', fullName: '', password: '' });
  const createUser = useMutation({
    mutationFn: () => api.post('/admin/org/users', newUser),
    onSuccess: () => { setNewUser({ email: '', fullName: '', password: '' }); invalidateOrg(); },
    onError: (e: any) => setErr(e.message),
  });
  const resetPw = (u: any) => { const p = prompt(`New password for ${u.email} (min 8 chars):`); if (p) api.post(`/admin/org/users/${u.id}/reset-password`, { password: p }).then(() => setErr(`✓ Password reset for ${u.email}`)).catch((e) => setErr(e.message)); };
  const toggleActive = (u: any) => api.patch(`/admin/org/users/${u.id}`, { isActive: !u.isActive }).then(invalidateOrg).catch((e) => setErr(e.message));
  const assign = (userId: string, cId: string, roleId: string) => api.post('/admin/org/memberships', { userId, companyId: cId, roleId }).then(invalidateOrg).catch((e) => setErr(e.message));
  const unassign = (userId: string, cId: string) => api.post('/admin/org/memberships/remove', { userId, companyId: cId }).then(invalidateOrg).catch((e) => setErr(e.message));
  const [accessFor, setAccessFor] = useState<string | null>(null); // userId whose access modal is open

  if (!companyId) return <Page title="Admin"><Empty>Select a company.</Empty></Page>;
  if (!can('user:manage')) return <Page title="Admin"><Empty>You need the <code>user:manage</code> permission to administer this company.</Empty></Page>;

  return (
    <Page title="Admin">
      <Banner text={err} />
      <div className="mb-4 flex gap-2">
        {(['members', 'users', 'companies', 'roles', 'audit', ...(can('system:manage') ? ['system'] : [])] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${tab === t ? 'bg-ink text-white' : 'border border-rule text-ink hover:bg-paper'}`}>{t === 'members' ? 'Members (this co.)' : t}</button>
        ))}
      </div>

      {tab === 'members' && (
        <>
          <Card title="Add member">
            <div className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
              <input value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} placeholder="email" className="rounded-md border border-rule px-2 py-1" />
              <select value={member.roleId} onChange={(e) => setMember({ ...member, roleId: e.target.value })} className="rounded-md border border-rule px-2 py-1">
                <option value="">Role…</option>
                {(roles.data ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <input value={member.fullName} onChange={(e) => setMember({ ...member, fullName: e.target.value })} placeholder="Full name (new user)" className="rounded-md border border-rule px-2 py-1" />
              <input value={member.password} onChange={(e) => setMember({ ...member, password: e.target.value })} placeholder="Temp password (new local user)" className="rounded-md border border-rule px-2 py-1" />
            </div>
            <div className="mt-3"><Button onClick={() => addMember.mutate()} disabled={!member.email || !member.roleId}>Add / update member</Button></div>
            <p className="mt-2 text-xs text-muted">Existing users (or SSO users who've signed in) are linked by email. Provide a temp password to create a new local user.</p>
          </Card>
          <div className="mt-4">
            <Table head={['Email', 'Name', 'Role', 'Auth', 'Active']}>
              {(members.data ?? []).map((m: any) => (
                <tr key={m.user.id}>
                  <td className="px-4 py-2 font-medium">{m.user.email}</td>
                  <td className="px-4 py-2">{m.user.fullName || '—'}</td>
                  <td className="px-4 py-2">
                    <select value={m.role.id} onChange={(e) => setRole(m.user.id, e.target.value)} className="rounded-md border border-rule px-2 py-1 text-sm">
                      {(roles.data ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-muted">{m.user.authProvider}</td>
                  <td className="px-4 py-2">{m.user.isActive ? '✓' : '—'}</td>
                </tr>
              ))}
              {(members.data ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">No members.</td></tr>}
            </Table>
          </div>
        </>
      )}

      {tab === 'users' && (
        <>
          <Card title="Create user">
            <div className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-3">
              <input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="email" className="rounded-md border border-rule px-2 py-1" />
              <input value={newUser.fullName} onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })} placeholder="Full name" className="rounded-md border border-rule px-2 py-1" />
              <input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="Password (min 8)" className="rounded-md border border-rule px-2 py-1" />
            </div>
            <div className="mt-3"><Button onClick={() => createUser.mutate()} disabled={!newUser.email || newUser.password.length < 8}>Create user</Button></div>
            <p className="mt-2 text-xs text-muted">Creates a global user. Grant them access to company files with “Manage access”.</p>
          </Card>
          <div className="mt-4">
            <Table head={['Email', 'Name', 'Active', 'Company access', '']}>
              {(orgUsers.data ?? []).map((u: any) => (
                <tr key={u.id}>
                  <td className="px-4 py-2 font-medium">{u.email}</td>
                  <td className="px-4 py-2">{u.fullName || '—'}</td>
                  <td className="px-4 py-2"><button onClick={() => toggleActive(u)} className="text-xs hover:underline">{u.isActive ? 'Active' : 'Inactive'}</button></td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {u.memberships.map((m: any) => <span key={m.companyId} className="rounded bg-paper px-1.5 py-0.5 text-xs">{m.company}: {m.role}</span>)}
                      {u.memberships.length === 0 && <span className="text-xs text-muted">none</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-flex gap-2">
                      <Button variant="ghost" onClick={() => setAccessFor(u.id)}>Manage access</Button>
                      <Button variant="ghost" onClick={() => resetPw(u)}>Reset password</Button>
                    </span>
                  </td>
                </tr>
              ))}
              {(orgUsers.data ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">No users.</td></tr>}
            </Table>
          </div>
        </>
      )}

      {tab === 'companies' && (
        <div className="space-y-4">
          {(orgCompanies.data ?? []).map((c: any) => (
            <Card key={c.id} title={c.legalName}>
              <div className="mb-2 text-xs text-muted">{c.baseCurrency} · created {date(c.createdAt)} · {c.members.length} member(s)</div>
              <Table head={['User', 'Role', '']}>
                {c.members.map((m: any) => (
                  <tr key={m.userId}>
                    <td className="px-4 py-2">{m.email}{m.fullName ? ` (${m.fullName})` : ''}</td>
                    <td className="px-4 py-2">{m.role}</td>
                    <td className="px-4 py-2 text-right"><button onClick={() => unassign(m.userId, c.id)} className="text-xs text-owed hover:underline">Remove</button></td>
                  </tr>
                ))}
                {c.members.length === 0 && <tr><td colSpan={3} className="px-4 py-4 text-center text-xs text-muted">No one has access.</td></tr>}
              </Table>
              <AddMemberRow companyId={c.id} users={orgUsers.data ?? []} roles={orgRoles.data ?? []} onAdd={assign} />
            </Card>
          ))}
          {(orgCompanies.data ?? []).length === 0 && <Empty>No companies.</Empty>}
        </div>
      )}

      {accessFor && (() => {
        const u = (orgUsers.data ?? []).find((x: any) => x.id === accessFor);
        if (!u) return null;
        return (
          <Modal title={`Company access — ${u.email}`} onClose={() => setAccessFor(null)}>
            <div className="space-y-2 text-sm">
              {(orgCompanies.data ?? []).map((c: any) => {
                const m = u.memberships.find((x: any) => x.companyId === c.id);
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3">
                    <span>{c.legalName}</span>
                    <select value={m?.roleId ?? ''} onChange={(e) => { const rid = e.target.value; rid ? assign(u.id, c.id, rid) : unassign(u.id, c.id); }} className="rounded-md border border-rule px-2 py-1">
                      <option value="">No access</option>
                      {(orgRoles.data ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end"><Button onClick={() => setAccessFor(null)}>Done</Button></div>
          </Modal>
        );
      })()}

      {tab === 'roles' && <RoleMatrix companyKey={key('roles')} />}

      {tab === 'audit' && (
        <Table head={['When', 'Actor', 'Action', 'Table', 'Record']}>
          {(audit.data ?? []).map((a: any) => (
            <tr key={a.id}>
              <td className="px-4 py-2">{date(a.createdAt)}</td>
              <td className="px-4 py-2 text-muted">{a.actorUserId || '—'}</td>
              <td className="px-4 py-2">{a.action}</td>
              <td className="px-4 py-2">{a.tableName}</td>
              <td className="px-4 py-2 text-muted">{a.recordId || '—'}</td>
            </tr>
          ))}
          {(audit.data ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">No audit entries yet.</td></tr>}
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

  if (q.isLoading) return <div className="text-sm text-muted">Loading…</div>;
  if (q.error) return <div className="text-sm text-owed">{(q.error as Error).message}</div>;
  const d = q.data;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Deployment-level settings. These apply to the whole OpenBooks instance, not a single company.
        Environment variables still act as the fallback for any field left blank here.
      </p>
      <OidcCard data={d.oidc} onSaved={invalidate} onError={onError} />
      <SamlCard data={d.saml} onSaved={invalidate} onError={onError} />
      <SmtpCard data={d.smtp} onSaved={invalidate} onError={onError} />
    </div>
  );
}

const inp = 'w-full rounded-md border border-rule px-3 py-2 text-sm';
function Field({ label, children }: { label: string; children: any }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
function StatusPill({ ok }: { ok: boolean }) {
  return <span className={`text-xs font-medium ${ok ? 'text-balance' : 'text-muted'}`}>{ok ? '● Configured' : '○ Not configured'}</span>;
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
      <label className="mt-3 flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} /> Use TLS (secure) connection
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => save.mutate()}>Save SMTP</Button>
        <span className="mx-2 text-muted">|</span>
        <input className="rounded-md border border-rule px-2 py-1 text-sm" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
        <Button variant="ghost" onClick={() => test.mutate()} disabled={!testTo.trim() || test.isPending}>{test.isPending ? 'Sending…' : 'Send test'}</Button>
        {testMsg && <span className="text-sm text-balance">{testMsg}</span>}
      </div>
    </Card>
  );
}
