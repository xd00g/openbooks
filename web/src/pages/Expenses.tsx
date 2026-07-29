import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, today, parseAmount, cleanAmount } from '../lib/format';
import { Page, Card, Table, Button, Empty, Modal } from '../components/ui';
import Attachments from '../components/Attachments';
import DocumentPreview from '../components/DocumentPreview';

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const setBline = (i: number, k: string, v: string) => setBlines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addBline = () => setBlines((ls) => [...ls, { ...emptyLine }]);
  const rmBline = (i: number) => setBlines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));
  const pickProduct = (i: number, itemId: string) => {
    const it = (products.data ?? []).find((p: any) => p.id === itemId);
    setBlines((ls) => ls.map((l, j) => (j === i ? { ...l, itemId, accountId: it?.expenseAccountId || l.accountId, description: it?.description ?? l.description, unitPrice: it?.unitPrice != null ? String(it.unitPrice) : l.unitPrice } : l)));
  };
  const billTotal = blines.reduce((s, l) => s + parseAmount(l.quantity || '0') * parseAmount(l.unitPrice || '0'), 0);
  const resetBillForm = () => { setBill(billHead); setBlines([{ ...emptyLine }]); setEditingId(null); };
  const saveBill = useMutation({
    mutationFn: () => {
      const payload = {
        vendorId: bill.vendorId, number: bill.number || undefined, issueDate: bill.issueDate, dueDate: bill.dueDate || undefined,
        lines: blines.filter((l) => l.accountId && l.unitPrice).map((l) => ({ accountId: l.accountId, itemId: l.itemId || undefined, description: l.description, quantity: cleanAmount(l.quantity) || '1', unitPrice: cleanAmount(l.unitPrice) })),
      };
      return editingId ? api.patch(`/expenses/bills/${editingId}`, payload) : api.post('/expenses/bills', payload);
    },
    onSuccess: () => { resetBillForm(); refresh(); },
    onError: (e: any) => setErr(e.message),
  });
  const editBill = async (b: any) => {
    setErr('');
    try {
      const full: any = await api.get(`/expenses/bills/${b.id}`);
      setBill({
        vendorId: full.vendorId, number: full.number || '',
        issueDate: String(full.issueDate).slice(0, 10),
        dueDate: full.dueDate ? String(full.dueDate).slice(0, 10) : '',
      });
      setBlines((full.lines ?? []).map((l: any) => ({
        itemId: l.itemId || '', accountId: l.accountId, description: l.description || '',
        quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(),
      })));
      setEditingId(b.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) { setErr(e.message); }
  };

  const finalize = (id: string) => wrap(api.post(`/expenses/bills/${id}/finalize`));
  const voidBill = (id: string) => { if (confirm('Void this bill? A reversing entry will be posted.')) wrap(api.post(`/expenses/bills/${id}/void`)); };
  const revertBill = (id: string) => { if (confirm('Revert this bill to draft? The posted entry will be reversed and it becomes editable again.')) wrap(api.post(`/expenses/bills/${id}/revert`)); };
  const deleteBill = (id: string) => { if (confirm('Delete this draft bill?')) wrap(api.del(`/expenses/bills/${id}`)); };
  const pay = (b: any) => {
    if (!bankAccounts[0]) return setErr('Create a bank account first.');
    wrap(api.post('/expenses/payments', {
      vendorId: b.vendorId, paymentDate: today(), bankAccountId: bankAccounts[0].id,
      allocations: [{ billId: b.id, amount: String(b.balanceDue) }],
    }));
  };

  if (!companyId) return <Page title="Expenses"><Empty>Select a company.</Empty></Page>;

  const selectedVendor = (vendors.data ?? []).find((v: any) => v.id === bill.vendorId);
  const previewParty = selectedVendor ? {
    name: selectedVendor.companyName || selectedVendor.displayName,
    sub: [
      selectedVendor.companyName ? selectedVendor.displayName : null,
      selectedVendor.email,
      selectedVendor.address?.line1,
      [selectedVendor.address?.city, selectedVendor.address?.region, selectedVendor.address?.postalCode].filter(Boolean).join(', ') || null,
    ].filter(Boolean),
  } : null;
  const previewLines = blines.map((l) => ({
    name: (products.data ?? []).find((p: any) => p.id === l.itemId)?.name,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    amount: parseAmount(l.quantity || '0') * parseAmount(l.unitPrice || '0'),
  }));

  return (
    <Page title="Expenses">
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_460px]">
        <Card title={editingId ? 'Edit bill' : 'New bill'}>
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
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

          <div className="mt-4 hidden text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:grid sm:grid-cols-12 sm:gap-1.5 sm:px-1">
            <div className="sm:col-span-3">Product / service</div>
            <div className="sm:col-span-3">Expense account</div>
            <div className="sm:col-span-4">Description</div>
            <div className="sm:col-span-1 text-right">Qty</div>
            <div className="sm:col-span-1 text-right">Price</div>
          </div>
          <div className="mt-1 space-y-2">
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
                  <input value={l.quantity} onChange={(e) => setBline(i, 'quantity', e.target.value)} placeholder="Qty" className="col-span-2 rounded-md border border-slate-300 px-2 py-1 text-right sm:col-span-1" />
                  <input value={l.unitPrice} onChange={(e) => setBline(i, 'unitPrice', e.target.value)} placeholder="Price" className="col-span-2 rounded-md border border-slate-300 px-2 py-1 text-right sm:col-span-1" />
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{money(parseAmount(l.quantity || '0') * parseAmount(l.unitPrice || '0'))}</span>
                  {blines.length > 1 && <button onClick={() => rmBline(i)} className="text-red-500 hover:underline">Remove</button>}
                </div>
              </div>
            ))}
            <button onClick={addBline} className="text-xs font-medium text-emerald-700 hover:underline">+ Add line item</button>
          </div>

          <div className="mt-4 flex flex-col items-end gap-3 border-t border-slate-200 pt-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-center gap-2">
              {editingId && <button onClick={resetBillForm} className="text-xs text-slate-500 hover:underline">Cancel edit</button>}
              <Button onClick={() => saveBill.mutate()} disabled={!bill.vendorId || !blines.some((l) => l.accountId && l.unitPrice)}>{editingId ? 'Save changes' : 'Create draft'}</Button>
            </div>
            <div className="w-full max-w-[220px] rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold text-slate-800"><span>Total</span><span>{money(billTotal)}</span></div>
            </div>
          </div>
        </Card>

        <DocumentPreview
          kind="BILL"
          number={bill.number || undefined}
          issueDate={bill.issueDate}
          dueDate={bill.dueDate || undefined}
          party={previewParty}
          lines={previewLines}
          subtotal={billTotal}
          taxTotal={0}
        />
      </div>

      <div className="mb-2 text-sm font-medium text-slate-600">Bills</div>
      <div className="max-h-[440px] overflow-y-auto rounded-xl">
        <Table head={['Vendor ref', 'Status', 'Total', 'Balance', '']}>
          {(bills.data ?? []).map((b: any) => (
            <tr key={b.id}>
              <td className="px-4 py-2 font-medium">{b.number || '—'}</td>
              <td className="px-4 py-2 capitalize text-slate-500">{b.status.replace(/_/g, ' ')}</td>
              <td className="px-4 py-2 text-right">{money(b.total, b.currency)}</td>
              <td className="px-4 py-2 text-right">{money(b.balanceDue, b.currency)}</td>
              <td className="px-4 py-2 text-right">
                <span className="inline-flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => setFilesFor(b.id)}>Files</Button>
                  {b.status === 'draft' && <Button variant="ghost" onClick={() => editBill(b)}>Edit</Button>}
                  {b.status === 'draft' && <Button variant="ghost" onClick={() => finalize(b.id)}>Finalize</Button>}
                  {b.status === 'draft' && <Button variant="ghost" onClick={() => deleteBill(b.id)}>Delete</Button>}
                  {b.status === 'open' && Number(b.amountPaid ?? 0) === 0 && (
                    <>
                      <Button variant="ghost" onClick={() => revertBill(b.id)}>Revert to Draft</Button>
                      <Button variant="ghost" onClick={() => voidBill(b.id)}>Void</Button>
                    </>
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
      </div>

      {filesFor && (
        <Modal title="Bill attachments" onClose={() => setFilesFor(null)}>
          <Attachments entityType="bill" entityId={filesFor} />
        </Modal>
      )}
    </Page>
  );
}
