import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, today } from '../lib/format';
import { Page, Card, Table, Button, Empty, Modal } from '../components/ui';
import Attachments from '../components/Attachments';

export default function Expenses() {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const key = (k: string) => [k, companyId];
  const [err, setErr] = useState('');
  const [filesFor, setFilesFor] = useState<string | null>(null);

  const vendors = useQuery({ queryKey: key('vendors'), enabled: !!companyId, queryFn: () => api.get('/expenses/vendors') });
  const bills = useQuery({ queryKey: key('bills'), enabled: !!companyId, queryFn: () => api.get('/expenses/bills') });
  const accounts = useQuery({ queryKey: key('accounts'), enabled: !!companyId, queryFn: () => api.get('/accounts') });
  const expenseAccounts = (accounts.data ?? []).filter((a: any) => a.type === 'expense');
  const bankAccounts = (accounts.data ?? []).filter((a: any) => a.subtype === 'bank');

  const refresh = () => qc.invalidateQueries({ queryKey: key('bills') });
  const wrap = (p: Promise<any>) => p.then(refresh).catch((e) => setErr(e.message));

  const emptyVend = { displayName: '', companyName: '', contactName: '', email: '', phone: '', mobile: '', website: '', taxId: '', line1: '', city: '', region: '', postalCode: '', country: '', is1099: false };
  const [vend, setVend] = useState(emptyVend);
  const addVendor = useMutation({
    mutationFn: () => {
      const { line1, city, region, postalCode, country, is1099, ...rest } = vend;
      const address = (line1 || city || region || postalCode || country)
        ? { line1, city, region, postalCode, country } : undefined;
      const payload: any = { is1099 };
      if (address) payload.address = address;
      for (const [k, v] of Object.entries(rest)) if (v) payload[k] = v;
      return api.post('/expenses/vendors', payload);
    },
    onSuccess: () => { setVend(emptyVend); qc.invalidateQueries({ queryKey: key('vendors') }); },
    onError: (e: any) => setErr(e.message),
  });

  const [bill, setBill] = useState({ vendorId: '', issueDate: today(), dueDate: '', accountId: '', description: '', quantity: '1', unitPrice: '' });
  const createBill = useMutation({
    mutationFn: () => api.post('/expenses/bills', {
      vendorId: bill.vendorId, issueDate: bill.issueDate, dueDate: bill.dueDate || undefined,
      lines: [{ accountId: bill.accountId, description: bill.description, quantity: bill.quantity, unitPrice: bill.unitPrice }],
    }),
    onSuccess: () => { setBill({ ...bill, description: '', unitPrice: '' }); refresh(); },
    onError: (e: any) => setErr(e.message),
  });

  const finalize = (id: string) => wrap(api.post(`/expenses/bills/${id}/finalize`));
  const pay = (b: any) => {
    if (!bankAccounts[0]) return setErr('Create a bank account first.');
    wrap(api.post('/expenses/payments', {
      vendorId: b.vendorId, paymentDate: today(), bankAccountId: bankAccounts[0].id,
      allocations: [{ billId: b.id, amount: String(b.balanceDue) }],
    }));
  };

  if (!companyId) return <Page title="Expenses"><Empty>Select a company.</Empty></Page>;

  return (
    <Page title="Expenses">
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="New vendor">
          <div className="grid grid-cols-2 gap-2">
            {([
              ['displayName', 'Display name *'], ['companyName', 'Company'],
              ['contactName', 'Contact person'], ['email', 'Email'],
              ['phone', 'Phone'], ['mobile', 'Mobile'], ['website', 'Website'],
              ['taxId', 'Tax ID (1099)'],
              ['line1', 'Address'], ['city', 'City'], ['region', 'State/Region'],
              ['postalCode', 'Postal code'], ['country', 'Country'],
            ] as [Exclude<keyof typeof vend, 'is1099'>, string][]).map(([f, label]) => (
              <input key={f} value={vend[f]} onChange={(e) => setVend({ ...vend, [f]: e.target.value })}
                placeholder={label} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={vend.is1099} onChange={(e) => setVend({ ...vend, is1099: e.target.checked })} />
            Track for 1099
          </label>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">{(vendors.data ?? []).length} vendors</span>
            <Button onClick={() => addVendor.mutate()} disabled={!vend.displayName}>Add vendor</Button>
          </div>
        </Card>

        <Card title="New bill">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <select value={bill.vendorId} onChange={(e) => setBill({ ...bill, vendorId: e.target.value })} className="col-span-2 rounded-md border border-slate-300 px-2 py-1">
              <option value="">Select vendor…</option>
              {(vendors.data ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.displayName}</option>)}
            </select>
            <select value={bill.accountId} onChange={(e) => setBill({ ...bill, accountId: e.target.value })} className="col-span-2 rounded-md border border-slate-300 px-2 py-1">
              <option value="">Expense account…</option>
              {expenseAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
            <input value={bill.description} onChange={(e) => setBill({ ...bill, description: e.target.value })} placeholder="Description" className="col-span-2 rounded-md border border-slate-300 px-2 py-1" />
            <input value={bill.quantity} onChange={(e) => setBill({ ...bill, quantity: e.target.value })} placeholder="Qty" className="rounded-md border border-slate-300 px-2 py-1" />
            <input value={bill.unitPrice} onChange={(e) => setBill({ ...bill, unitPrice: e.target.value })} placeholder="Unit price" className="rounded-md border border-slate-300 px-2 py-1" />
          </div>
          <div className="mt-3"><Button onClick={() => createBill.mutate()} disabled={!bill.vendorId || !bill.accountId || !bill.unitPrice}>Create draft</Button></div>
        </Card>
      </div>

      <Table head={['Vendor ref', 'Status', 'Total', 'Balance', '']}>
        {(bills.data ?? []).map((b: any) => (
          <tr key={b.id}>
            <td className="px-4 py-2 font-medium">{b.number || '—'}</td>
            <td className="px-4 py-2 capitalize text-slate-500">{b.status.replace(/_/g, ' ')}</td>
            <td className="px-4 py-2 text-right">{money(b.total)}</td>
            <td className="px-4 py-2 text-right">{money(b.balanceDue)}</td>
            <td className="px-4 py-2 text-right">
              <span className="inline-flex gap-2">
                <Button variant="ghost" onClick={() => setFilesFor(b.id)}>Files</Button>
                {b.status === 'draft' && <Button variant="ghost" onClick={() => finalize(b.id)}>Finalize</Button>}
                {(b.status === 'open' || b.status === 'partially_paid') && Number(b.balanceDue) > 0 && (
                  <Button variant="ghost" onClick={() => pay(b)}>Pay</Button>
                )}
              </span>
            </td>
          </tr>
        ))}
        {(bills.data ?? []).length === 0 && (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No bills yet.</td></tr>
        )}
      </Table>

      {filesFor && (
        <Modal title="Bill attachments" onClose={() => setFilesFor(null)}>
          <Attachments entityType="bill" entityId={filesFor} />
        </Modal>
      )}
    </Page>
  );
}
