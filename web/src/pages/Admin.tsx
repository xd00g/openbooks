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

type Tab = 'members' | 'roles' | 'audit';

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
        {(['members', 'roles', 'audit'] as Tab[]).map((t) => (
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
    </Page>
  );
}
