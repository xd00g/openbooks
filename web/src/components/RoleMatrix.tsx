import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Card, Table, Button, Banner, Empty } from './ui';

interface PermissionDef {
  key: string;
  group: string;
  label: string;
  description: string;
  risk: 'normal' | 'high';
}

interface Role {
  id: string;
  name: string;
  description?: string | null;
  permissions: string[];
  isSystem?: boolean;
}

export default function RoleMatrix({ companyKey }: { companyKey: unknown[] }) {
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const [newName, setNewName] = useState('');
  const [draft, setDraft] = useState<string[]>([]);

  const catalog = useQuery<PermissionDef[]>({
    queryKey: ['permissions'],
    queryFn: () => api.get('/admin/permissions'),
  });
  const roles = useQuery<Role[]>({
    queryKey: companyKey,
    queryFn: () => api.get('/admin/roles'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/admin/roles', { name: newName, permissions: draft }),
    onSuccess: () => {
      setNewName('');
      setDraft([]);
      setErr('✓ Role created.');
      qc.invalidateQueries({ queryKey: companyKey });
    },
    onError: (e: any) => setErr(e.message),
  });

  const toggle = (key: string) =>
    setDraft((d) => (d.includes(key) ? d.filter((x) => x !== key) : [...d, key]));

  const defs = catalog.data ?? [];
  const groups = [...new Set(defs.map((d) => d.group))];
  const roleList = roles.data ?? [];

  /** Mirrors authz.ts: '*' allows everything, 'resource:*' allows the resource. */
  const held = (role: Role, key: string) =>
    role.permissions.includes('*') ||
    role.permissions.includes(key) ||
    role.permissions.includes(`${key.split(':')[0]}:*`);

  const catalogErr = catalog.isError
    ? `Could not load the permission catalog: ${(catalog.error as Error).message}`
    : '';
  const rolesErr = roles.isError
    ? `Could not load roles: ${(roles.error as Error).message}`
    : '';
  const bannerText = err || catalogErr || rolesErr;

  return (
    <div className="space-y-6">
      <Banner text={bannerText} />

      <Card title="Permission matrix">
        {catalog.isLoading ? (
          <Empty>Loading permissions…</Empty>
        ) : catalog.isError ? (
          <Empty>The permission catalog failed to load.</Empty>
        ) : defs.length === 0 ? (
          <Empty>No permissions defined.</Empty>
        ) : (
          <Table head={['Permission', ...roleList.map((r) => r.name), 'New role']}>
            {groups.map((g) => (
              <Fragment key={g}>
                <tr>
                  <td
                    colSpan={roleList.length + 2}
                    className="px-4 py-2 text-xs uppercase tracking-wide text-muted"
                  >
                    {g}
                  </td>
                </tr>
                {defs
                  .filter((d) => d.group === g)
                  .map((d) => (
                    <tr key={d.key}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{d.key}</span>
                          {d.risk === 'high' && (
                            <span className="text-eyebrow uppercase text-owed">
                              high risk
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted">{d.description}</div>
                      </td>
                      {roleList.map((r) => {
                        const grants = held(r, d.key);
                        return (
                          <td
                            key={r.id}
                            className="px-4 py-2 text-center"
                            aria-label={`${r.name} ${grants ? 'has' : 'does not have'} ${d.key}`}
                          >
                            {grants ? '●' : '·'}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={draft.includes(d.key)}
                          onChange={() => toggle(d.key)}
                          aria-label={`Grant ${d.key} to the new role`}
                        />
                      </td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </Table>
        )}

        <div className="mt-4 flex items-end gap-3">
          <label className="text-xs uppercase tracking-wide text-muted">
            New role name
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="mt-1 block w-56 rounded-md border border-rule px-2 py-1"
            />
          </label>
          <Button
            onClick={() => create.mutate()}
            disabled={!newName || draft.length === 0 || create.isPending}
          >
            Create role
          </Button>
        </div>
      </Card>
    </div>
  );
}
