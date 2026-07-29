import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Page, Table, Button, Empty, Modal } from '../components/ui';

/** Subtypes grouped by the top-level type they belong to. The server derives
 *  `type` from the chosen subtype, so the UI only needs to offer subtypes. */
const SUBTYPES: Record<string, { value: string; label: string }[]> = {
  asset: [
    { value: 'bank', label: 'Bank' },
    { value: 'accounts_receivable', label: 'Accounts Receivable' },
    { value: 'undeposited_funds', label: 'Undeposited Funds' },
    { value: 'inventory', label: 'Inventory' },
    { value: 'fixed_asset', label: 'Fixed Asset' },
    { value: 'other_current_asset', label: 'Other Current Asset' },
    { value: 'other_asset', label: 'Other Asset' },
  ],
  liability: [
    { value: 'accounts_payable', label: 'Accounts Payable' },
    { value: 'credit_card', label: 'Credit Card' },
    { value: 'sales_tax_payable', label: 'Sales Tax Payable' },
    { value: 'payroll_liability', label: 'Payroll Liability' },
    { value: 'other_current_liability', label: 'Other Current Liability' },
    { value: 'long_term_liability', label: 'Long-term Liability' },
  ],
  equity: [
    { value: 'retained_earnings', label: 'Retained Earnings' },
    { value: 'opening_balance_equity', label: 'Opening Balance Equity' },
    { value: 'owners_equity', label: "Owner's Equity" },
  ],
  income: [
    { value: 'income', label: 'Income' },
    { value: 'other_income', label: 'Other Income' },
  ],
  expense: [
    { value: 'cost_of_goods_sold', label: 'Cost of Goods Sold' },
    { value: 'expense', label: 'Expense' },
    { value: 'other_expense', label: 'Other Expense' },
  ],
};

const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];
const ALL_SUBTYPES = TYPE_ORDER.flatMap((t) => SUBTYPES[t]);
const subtypeLabel = (v: string) =>
  ALL_SUBTYPES.find((s) => s.value === v)?.label ?? v.replace(/_/g, ' ');

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype: string;
  parentId: string | null;
  isActive: boolean;
  isSystem: boolean;
  description?: string | null;
}

export default function Accounting() {
  const { companyId, can } = useAuth();
  const qc = useQueryClient();
  const editable = can('account:manage');
  const [err, setErr] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [adding, setAdding] = useState(false);

  const q = useQuery<Account[]>({
    queryKey: ['accounts', companyId],
    enabled: !!companyId,
    queryFn: () => api.get('/accounts'),
  });

  const accounts = q.data ?? [];
  const visible = showInactive ? accounts : accounts.filter((a) => a.isActive);
  const byType = useMemo(() => {
    const m: Record<string, Account[]> = {};
    for (const a of visible) (m[a.type] ??= []).push(a);
    return m;
  }, [visible]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['accounts', companyId] });
  const toggleActive = (a: Account) =>
    api.patch(`/accounts/${a.id}`, { isActive: !a.isActive }).then(invalidate).catch((e) => setErr(e.message));
  const remove = (a: Account) => {
    if (!confirm(`Delete account ${a.code} ${a.name}? This cannot be undone.`)) return;
    api.del(`/accounts/${a.id}`).then(invalidate).catch((e) => setErr(e.message));
  };

  if (!companyId) return <Page title="Chart of Accounts"><Empty>Select a company.</Empty></Page>;

  return (
    <Page
      title="Chart of Accounts"
      actions={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
          {editable && <Button onClick={() => setAdding(true)}>Add account</Button>}
        </div>
      }
    >
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {!editable && <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">You have read-only access to the chart of accounts.</div>}

      {q.isLoading && <div className="text-sm text-slate-400">Loading…</div>}

      <div className="space-y-6">
        {TYPE_ORDER.filter((t) => byType[t]?.length).map((t) => (
          <div key={t}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{t}</h2>
            <Table head={editable ? ['Code', 'Name', 'Subtype', 'Status', ''] : ['Code', 'Name', 'Subtype', 'Status']}>
              {byType[t].map((a) => (
                <tr key={a.id} className={a.isActive ? '' : 'opacity-50'}>
                  <td className="px-4 py-2 text-slate-500">{a.code}</td>
                  <td className="px-4 py-2">
                    {a.parentId && <span className="text-slate-300">↳ </span>}
                    {a.name}
                    {a.isSystem && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">System</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{subtypeLabel(a.subtype)}</td>
                  <td className="px-4 py-2 text-xs">{a.isActive ? <span className="text-emerald-600">Active</span> : <span className="text-slate-400">Inactive</span>}</td>
                  {editable && (
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2 text-xs">
                        <button onClick={() => setEditing(a)} className="text-slate-600 hover:text-slate-900">Edit</button>
                        <button onClick={() => toggleActive(a)} disabled={a.isSystem && a.isActive} className="text-slate-600 hover:text-slate-900 disabled:opacity-30">
                          {a.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        {!a.isSystem && <button onClick={() => remove(a)} className="text-red-500 hover:text-red-700">Delete</button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </Table>
          </div>
        ))}
        {visible.length === 0 && !q.isLoading && <Empty>No accounts.</Empty>}
      </div>

      {adding && (
        <AccountForm
          accounts={accounts}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); invalidate(); }}
          onError={setErr}
        />
      )}
      {editing && (
        <AccountForm
          account={editing}
          accounts={accounts}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
          onError={setErr}
        />
      )}
    </Page>
  );
}

function AccountForm({
  account,
  accounts,
  onClose,
  onSaved,
  onError,
}: {
  account?: Account;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const isEdit = !!account;
  const [form, setForm] = useState({
    code: account?.code ?? '',
    name: account?.name ?? '',
    subtype: account?.subtype ?? 'expense',
    parentId: account?.parentId ?? '',
    description: account?.description ?? '',
  });

  const parentType = Object.entries(SUBTYPES).find(([, list]) => list.some((s) => s.value === form.subtype))?.[0];
  const parentOptions = accounts.filter(
    (a) => a.id !== account?.id && a.type === parentType,
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code.trim(),
        name: form.name.trim(),
        subtype: form.subtype,
        parentId: form.parentId || null,
        description: form.description.trim(),
      };
      return isEdit ? api.patch(`/accounts/${account!.id}`, body) : api.post('/accounts', body);
    },
    onSuccess: onSaved,
    onError: (e: any) => onError(e.message),
  });

  const field = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
  const lockType = isEdit && account!.isSystem;

  return (
    <Modal title={isEdit ? `Edit ${account!.code}` : 'Add account'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-1 block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Code</span>
            <input value={form.code} disabled={lockType} onChange={(e) => setForm({ ...form, code: e.target.value })} className={field} />
          </label>
          <label className="col-span-2 block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Name</span>
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Type</span>
          <select
            value={form.subtype}
            disabled={lockType}
            onChange={(e) => setForm({ ...form, subtype: e.target.value, parentId: '' })}
            className={field}
          >
            {TYPE_ORDER.map((t) => (
              <optgroup key={t} label={t.toUpperCase()}>
                {SUBTYPES[t].map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Parent account <span className="font-normal text-slate-400">(optional — for sub-accounts / cost codes)</span></span>
          <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} className={field}>
            <option value="">None (top-level)</option>
            {parentOptions.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Description <span className="font-normal text-slate-400">(optional)</span></span>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={field} />
        </label>
      </div>
      {lockType && <p className="mt-3 text-xs text-slate-400">This is a system account — its code and type are protected, but you can rename it and set a parent.</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!form.code.trim() || !form.name.trim()}>
          {isEdit ? 'Save changes' : 'Add account'}
        </Button>
      </div>
    </Modal>
  );
}
