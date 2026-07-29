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

  const products = useQuery({ queryKey: key('items'), enabled: !!companyId, queryFn: () => api.get('/items') });

  const emptyLine = { itemId: '', accountId: '', description: '', quantity: '1', unitPrice: '' };
  const billHead = { vendorId: '', number: '', issueDate: today(), dueDate: '' };
  const [bill, setBill] = useState(billHead);
  const [blines, setBlines] = useState<(typeof emptyLine)[]>([{ ...emptyLine }]);
  const setBline = (i: number, k: string, v: string) => setBlines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addBline = () => setBlines((ls) => [...ls, { ...emptyLine }]);
  const rmBline = (i: number) => setBlines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));
  const pickProduct = (i: number, itemId: string) => {
    const it = (products.data ?? []).find((p: any) => p.id === itemId);
    setBlines((ls) => ls.map((l, j) => (j === i ? { ...l, itemId, accountId: it?.expenseAccountId || l.accountId, description: it ? (it.description || it.name) : l.description, unitPrice: it?.unitPrice != null ? String(it.unitPrice) : l.unitPrice } : l)));
  };
  const billTotal = blines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  const createBill = useMutation({
    mutationFn: () => api.post('/expenses/bills', {
      vendorId: bill.vendorId, number: bill.number || undefined, issueDate: bill.issueDate, dueDate: bill.dueDate || undefined,
      lines: blines.filter((l) => l.accountId && l.unitPrice).map((l) => ({ accountId: l.accountId, itemId: l.itemId || undefined, description: l.description, quantity: l.quantity || '1', unitPrice: l.unitPrice })),
    }),
    onSuccess: () => { setBill(billHead); setBlines([{ ...emptyLine }]); refresh(); },
    onError: (e: any) => setErr(e.message),
  });

  const finalize = (id: string) => wrap(api.post(`/expenses/bills/${id}/finalize`));
  const voidBill = (id: string) => { if (confirm('Void this bill? A reversing entry will be posted.')) wrap(api.post(`/expenses/bills/${id}/void`)); };
  const deleteBill = (id: string) => { if (confirm('Delete this draft bill?')) wrap(api.del(`/expenses/bills/${id}`)); };
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

      <div className="mb-6">
        <Card title="New bill">
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-4">
            <select value={bill.vendorId} onChange={(e) => setBill({ ...bill, vendorId: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 sm:col-span-2">
              <option value="">Select vendor…</option>
              {(vendors.data ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.displayName}</option>)}
            </select>
            <input value={bill.number} onChange={(e) => setBill({ ...bill, number: e.target.value })} placeholder="Vendor ref # (optional)" className="rounded-md border border-slate-300 px-2 py-1 sm:col-span-2" />
            <label className="text-xs text-slate-500">Bill date
              <input type="date" value={bill.issueDate} onChange={(e) => setBill({ ...bill, issueDate: e.target.value })} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1" />
            </label>
            <label className="text-xs text-slate-500">Due date (optional)
              <input type="date" value={bill.dueDate} onChange={(e) => setBill({ ...bill, dueDate: e.target.value })} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1" />
            </label>
          </div>

          <div className="mt-3 space-y-2">
            {blines.map((l, i) => (
              <div key={i} className="rounded-md border border-slate-200 p-2">
                <div className="grid grid-cols-12 gap-1.5 text-sm">
                  <select value={l.itemId} onChange={(e) => pickProduct(i, e.target.value)} className="col-span-12 rounded-md border border-slate-300 px-2 py-1 sm:col-span-3" title="Product / service">
                    <option value="">Product/service…</option>
                    {(products.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select value={l.accountId} onChange={(e) => setBline(i, 'accountId', e.target.value)} className="col-span-12 rounded-md border border-slate-300 px-2 py-1 sm:col-span-3" title="Expense account">
                    <option value="">Expense account…</option>
                    {expenseAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                  </select>
                  <input value={l.description} onChange={(e) => setBline(i, 'description', e.target.value)} placeholder="Description" className="col-span-8 rounded-md border border-slate-300 px-2 py-1 sm:col-span-4" />
                  <input value={l.quantity} onChange={(e) => setBline(i, 'quantity', e.target.value)} placeholder="Qty" className="col-span-2 rounded-md border border-slate-300 px-2 py-1 sm:col-span-1" />
                  <input value={l.unitPrice} onChange={(e) => setBline(i, 'unitPrice', e.target.value)} placeholder="Price" className="col-span-2 rounded-md border border-slate-300 px-2 py-1 sm:col-span-1" />
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                  <span>Line: {money(Number(l.quantity || 0) * Number(l.unitPrice || 0))}</span>
                  {blines.length > 1 && <button onClick={() => rmBline(i)} className="text-red-500 hover:underline">Remove</button>}
                </div>
              </div>
            ))}
            <button onClick={addBline} className="text-xs text-emerald-700 hover:underline">+ Add line item</button>
          </div>

          <div className="mt-3 flex items-end justify-between">
            <div className="text-xs font-semibold text-slate-800">Total: {money(billTotal)}</div>
            <Button onClick={() => createBill.mutate()} disabled={!bill.vendorId || !blines.some((l) => l.accountId && l.unitPrice)}>Create draft</Button>
          </div>
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
                {b.status === 'draft' && <Button variant="ghost" onClick={() => deleteBill(b.id)}>Delete</Button>}
                {b.status === 'open' && Number(b.amountPaid ?? 0) === 0 && (
                  <Button variant="ghost" onClick={() => voidBill(b.id)}>Void</Button>
                )}
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
