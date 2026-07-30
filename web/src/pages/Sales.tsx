import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, today, parseAmount, cleanAmount } from '../lib/format';
import { Page, Card, Table, Button, Empty, Modal, Banner, SearchInput, toggleSort, type SortState } from '../components/ui';
import Attachments from '../components/Attachments';
import DocumentPreview from '../components/DocumentPreview';

export default function Sales() {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const key = (k: string) => [k, companyId];
  const [err, setErr] = useState('');
  const [filesFor, setFilesFor] = useState<string | null>(null);
  const [invQ, setInvQ] = useState('');
  const [invSort, setInvSort] = useState<SortState | null>(null);

  const customers = useQuery({ queryKey: key('customers'), enabled: !!companyId, queryFn: () => api.get('/sales/customers') });
  const invoices = useQuery({ queryKey: key('invoices'), enabled: !!companyId, queryFn: () => api.get('/sales/invoices') });
  const accounts = useQuery({ queryKey: key('accounts'), enabled: !!companyId, queryFn: () => api.get('/accounts') });
  const incomeAccounts = (accounts.data ?? []).filter((a: any) => a.type === 'income');
  const taxRates = useQuery({ queryKey: key('tax-rates'), enabled: !!companyId, queryFn: () => api.get('/tax/rates') });
  const terms = useQuery({ queryKey: key('payment-terms'), enabled: !!companyId, queryFn: () => api.get('/payment-terms') });
  const products = useQuery({ queryKey: key('items'), enabled: !!companyId, queryFn: () => api.get('/items') });

  const refresh = () => { qc.invalidateQueries({ queryKey: key('invoices') }); };
  const wrap = (p: Promise<any>) => p.then(refresh).catch((e) => setErr(e.message));

  // new invoice (multi-line)
  const emptyLine = { itemId: '', accountId: '', description: '', quantity: '1', unitPrice: '', taxRateId: '' };
  const pickProduct = (i: number, itemId: string) => {
    const it = (products.data ?? []).find((p: any) => p.id === itemId);
    // The product Name becomes the line's title (shown on the PDF/invoice);
    // its Description becomes the subtitle underneath — keep them distinct
    // rather than collapsing into one field.
    setLines((ls) => ls.map((l, j) => (j === i ? {
      ...l, itemId,
      accountId: it?.incomeAccountId || l.accountId,
      description: it?.description ?? l.description,
      unitPrice: it?.unitPrice != null ? String(it.unitPrice) : l.unitPrice,
    } : l)));
  };
  const invHead = { customerId: '', issueDate: today(), dueDate: '', paymentTermId: '', memo: '' };
  const [inv, setInv] = useState(invHead);
  const [lines, setLines] = useState<(typeof emptyLine)[]>([{ ...emptyLine }]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const setLine = (i: number, k: string, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((ls) => [...ls, { ...emptyLine }]);
  const rmLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));
  const ratePct = (id: string) => { const t = (taxRates.data ?? []).find((x: any) => x.id === id); return t ? Number(t.rate) : 0; };
  // parseAmount strips $ / commas / stray characters so a pasted "1,000,000"
  // (or "$1,000,000.00") computes correctly instead of yielding NaN.
  const lineTotal = (l: typeof emptyLine) => parseAmount(l.quantity || '0') * parseAmount(l.unitPrice || '0');
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const taxTotal = lines.reduce((s, l) => s + lineTotal(l) * ratePct(l.taxRateId), 0);
  const resetForm = () => { setInv(invHead); setLines([{ ...emptyLine }]); setEditingId(null); };
  const saveInvoice = useMutation({
    mutationFn: () => {
      const payload = {
        customerId: inv.customerId,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate || undefined,
        paymentTermId: inv.paymentTermId || undefined,
        memo: inv.memo || undefined,
        lines: lines.filter((l) => l.accountId && l.unitPrice).map((l) => ({ accountId: l.accountId, itemId: l.itemId || undefined, description: l.description, quantity: cleanAmount(l.quantity) || '1', unitPrice: cleanAmount(l.unitPrice), taxRateId: l.taxRateId || undefined })),
      };
      return editingId ? api.patch(`/sales/invoices/${editingId}`, payload) : api.post('/sales/invoices', payload);
    },
    onSuccess: () => { resetForm(); refresh(); },
    onError: (e: any) => setErr(e.message),
  });
  const editInvoice = async (i: any) => {
    setErr('');
    try {
      const full: any = await api.get(`/sales/invoices/${i.id}`);
      setInv({
        customerId: full.customerId,
        issueDate: String(full.issueDate).slice(0, 10),
        dueDate: full.dueDate ? String(full.dueDate).slice(0, 10) : '',
        paymentTermId: full.paymentTermId || '',
        memo: full.memo || '',
      });
      setLines(full.lines.map((l: any) => ({
        itemId: l.itemId || '', accountId: l.accountId, description: l.description || '',
        quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), taxRateId: l.taxRateId || '',
      })));
      setEditingId(i.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) { setErr(e.message); }
  };
  const downloadPdf = (i: any) => api.blobUrl(`/sales/invoices/${i.id}/pdf`).then((u) => window.open(u, '_blank')).catch((e) => setErr(e.message));
  const sendInvoice = (i: any) => {
    const cc = prompt('Email this invoice to the customer.\nOptional CC (comma-separated), or leave blank:');
    if (cc === null) return; // cancelled
    wrap(api.post(`/sales/invoices/${i.id}/send`, cc.trim() ? { cc: cc.trim() } : {}).then((r: any) => setErr(`✓ Sent to ${r.to}${r.cc ? ` (cc ${r.cc})` : ''}`)));
  };

  const finalize = (id: string) => wrap(api.post(`/sales/invoices/${id}/finalize`));
  const voidInvoice = (id: string) => { if (confirm('Void this invoice? A reversing entry will be posted.')) wrap(api.post(`/sales/invoices/${id}/void`)); };
  const revertInvoice = (id: string) => { if (confirm('Revert this invoice to draft? The posted entry will be reversed and it becomes editable again.')) wrap(api.post(`/sales/invoices/${id}/revert`)); };
  const deleteInvoice = (id: string) => { if (confirm('Delete this draft invoice?')) wrap(api.del(`/sales/invoices/${id}`)); };
  const receive = (i: any) => wrap(api.post('/sales/payments', {
    customerId: i.customerId, paymentDate: today(),
    allocations: [{ invoiceId: i.id, amount: String(i.balanceDue) }],
  }));

  if (!companyId) return <Page title="Sales"><Empty>Select a company.</Empty></Page>;

  const selectedCustomer = (customers.data ?? []).find((c: any) => c.id === inv.customerId);
  const previewParty = selectedCustomer ? {
    name: selectedCustomer.companyName || selectedCustomer.displayName,
    sub: [
      selectedCustomer.companyName && selectedCustomer.companyName !== selectedCustomer.displayName ? selectedCustomer.displayName : null,
      selectedCustomer.email,
      selectedCustomer.billingAddress?.line1,
      [selectedCustomer.billingAddress?.city, selectedCustomer.billingAddress?.region, selectedCustomer.billingAddress?.postalCode].filter(Boolean).join(', ') || null,
    ].filter(Boolean),
  } : null;
  const previewLines = lines.map((l) => ({
    name: (products.data ?? []).find((p: any) => p.id === l.itemId)?.name,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    amount: lineTotal(l),
  }));

  const customerName = (id: string) => (customers.data ?? []).find((c: any) => c.id === id)?.displayName ?? '—';
  const invoiceRows = (() => {
    let r = (invoices.data ?? []).map((i: any) => ({ ...i, customerName: customerName(i.customerId) }));
    if (invQ.trim()) {
      const needle = invQ.trim().toLowerCase();
      r = r.filter((i: any) => [i.number, i.customerName, i.status].some((v) => String(v ?? '').toLowerCase().includes(needle)));
    }
    if (invSort) {
      const key = invSort.key;
      r = [...r].sort((a: any, b: any) => {
        const va = key === 'total' || key === 'balanceDue' ? Number(a[key]) : a[key];
        const vb = key === 'total' || key === 'balanceDue' ? Number(b[key]) : b[key];
        const cmp = va > vb ? 1 : va < vb ? -1 : 0;
        return invSort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return r;
  })();

  return (
    <Page title="Sales">
      <Banner text={err} />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_460px] xl:grid-cols-[minmax(0,1fr)_540px] 2xl:grid-cols-[minmax(0,1fr)_620px]">
        <Card title={editingId ? 'Edit invoice' : 'New invoice'}>
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <select value={inv.customerId} onChange={(e) => setInv({ ...inv, customerId: e.target.value })} className="sm:col-span-2 rounded-md border border-rule px-2 py-1">
              <option value="">Select customer…</option>
              {(customers.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
            </select>
            <select value={inv.paymentTermId} onChange={(e) => setInv({ ...inv, paymentTermId: e.target.value })} className="col-span-2 rounded-md border border-rule px-2 py-1">
              <option value="">Payment term (sets due date)…</option>
              {(terms.data ?? []).filter((t: any) => t.isActive !== false).map((t: any) => <option key={t.id} value={t.id}>{t.name} — net {t.dueInDays}d</option>)}
            </select>
            <label className="text-xs text-muted">Invoice date
              <input type="date" value={inv.issueDate} onChange={(e) => setInv({ ...inv, issueDate: e.target.value })} className="mt-1 block w-full rounded-md border border-rule px-2 py-1" />
            </label>
            <label className="text-xs text-muted">Due date {inv.paymentTermId ? '(auto from term)' : '(optional)'}
              <input type="date" value={inv.dueDate} onChange={(e) => setInv({ ...inv, dueDate: e.target.value })} className="mt-1 block w-full rounded-md border border-rule px-2 py-1" />
            </label>
          </div>

          <div className="mt-4 hidden text-[11px] font-semibold uppercase tracking-wide text-muted sm:grid sm:grid-cols-12 sm:gap-1.5 sm:px-1">
            <div className="sm:col-span-3">Product / service</div>
            <div className="sm:col-span-3">Income account</div>
            <div className="sm:col-span-3">Description</div>
            <div className="sm:col-span-1 text-right">Qty</div>
            <div className="sm:col-span-1 text-right">Price</div>
            <div className="sm:col-span-1">Tax</div>
          </div>
          <div className="mt-1 space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="rounded-md border border-rule p-2">
                <div className="grid grid-cols-12 gap-1.5 text-sm">
                  <select value={l.itemId} onChange={(e) => pickProduct(i, e.target.value)} className="col-span-12 rounded-md border border-rule px-2 py-1 sm:col-span-3" title="Product / service">
                    <option value="">Product/service…</option>
                    {(products.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select value={l.accountId} onChange={(e) => setLine(i, 'accountId', e.target.value)} className="col-span-12 rounded-md border border-rule px-2 py-1 sm:col-span-3" title="Income account">
                    <option value="">Income account…</option>
                    {incomeAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                  </select>
                  <input value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} placeholder="Description" className="col-span-6 rounded-md border border-rule px-2 py-1 sm:col-span-3" />
                  <input value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} placeholder="Qty" className="col-span-2 rounded-md border border-rule px-2 py-1 text-right sm:col-span-1" />
                  <input value={l.unitPrice} onChange={(e) => setLine(i, 'unitPrice', e.target.value)} placeholder="Price" className="col-span-4 rounded-md border border-rule px-2 py-1 text-right sm:col-span-1" />
                  <select value={l.taxRateId} onChange={(e) => setLine(i, 'taxRateId', e.target.value)} className="col-span-12 rounded-md border border-rule px-2 py-1 sm:col-span-1" title="Sales tax">
                    <option value="">No sales tax</option>
                    {(taxRates.data ?? []).filter((t: any) => t.isActive !== false).map((t: any) => <option key={t.id} value={t.id}>{t.name} ({(Number(t.rate) * 100).toFixed(3).replace(/\.?0+$/, '')}%)</option>)}
                  </select>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted">
                  <span className="font-medium text-ink">{money(lineTotal(l))}</span>
                  {lines.length > 1 && <button onClick={() => rmLine(i)} className="text-owed hover:underline">Remove</button>}
                </div>
              </div>
            ))}
            <button onClick={addLine} className="text-xs font-medium text-ink hover:underline">+ Add line item</button>
          </div>

          <input value={inv.memo} onChange={(e) => setInv({ ...inv, memo: e.target.value })} placeholder="Notes (appear on the PDF)" className="mt-3 w-full rounded-md border border-rule px-2 py-1 text-sm" />

          <div className="mt-4 flex flex-col items-end gap-3 border-t border-rule pt-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-center gap-2">
              {editingId && <button onClick={resetForm} className="text-xs text-muted hover:underline">Cancel edit</button>}
              <Button onClick={() => saveInvoice.mutate()} disabled={!inv.customerId || !lines.some((l) => l.accountId && l.unitPrice)}>{editingId ? 'Save changes' : 'Create draft'}</Button>
            </div>
            <div className="w-full max-w-[220px] rounded-lg bg-paper p-3 text-sm">
              <div className="flex justify-between text-muted"><span>Subtotal</span><span>{money(subtotal)}</span></div>
              <div className="flex justify-between text-muted"><span>Tax</span><span>{money(taxTotal)}</span></div>
              <div className="mt-1 flex justify-between border-t border-rule pt-1 text-base font-semibold text-ink"><span>Total</span><span>{money(subtotal + taxTotal)}</span></div>
            </div>
          </div>
        </Card>

        <DocumentPreview
          kind="INVOICE"
          number={editingId ? (invoices.data ?? []).find((i: any) => i.id === editingId)?.number : undefined}
          issueDate={inv.issueDate}
          dueDate={inv.dueDate || undefined}
          party={previewParty}
          lines={previewLines}
          subtotal={subtotal}
          taxTotal={taxTotal}
          memo={inv.memo}
        />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium text-muted">Invoices</div>
        <SearchInput value={invQ} onChange={setInvQ} placeholder="Search invoices…" />
      </div>
      <div className="max-h-[440px] overflow-y-auto rounded-xl">
        <Table
          head={[{ label: 'Number', key: 'number' }, { label: 'Customer', key: 'customerName' }, { label: 'Status', key: 'status' }, { label: 'Total', key: 'total' }, { label: 'Balance', key: 'balanceDue' }, '']}
          sort={invSort}
          onSort={(k) => setInvSort((s) => toggleSort(s, k))}
        >
          {invoiceRows.map((i: any) => (
            <tr key={i.id}>
              <td className="px-4 py-2 font-medium">{i.number}</td>
              <td className="px-4 py-2">{i.customerName}</td>
              <td className="px-4 py-2 capitalize text-muted">{i.status.replace(/_/g, ' ')}</td>
              <td className="px-4 py-2 text-right">{money(i.total, i.currency)}</td>
              <td className="px-4 py-2 text-right">{money(i.balanceDue, i.currency)}</td>
              <td className="px-4 py-2 text-right">
                <span className="inline-flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => downloadPdf(i)}>PDF</Button>
                  {i.status !== 'void' && <Button variant="ghost" onClick={() => sendInvoice(i)}>Send</Button>}
                  <Button variant="ghost" onClick={() => setFilesFor(i.id)}>Files</Button>
                  {i.status === 'draft' && <Button variant="ghost" onClick={() => editInvoice(i)}>Edit</Button>}
                  {i.status === 'draft' && <Button variant="ghost" onClick={() => finalize(i.id)}>Finalize</Button>}
                  {i.status === 'draft' && <Button variant="ghost" onClick={() => deleteInvoice(i.id)}>Delete</Button>}
                  {(i.status === 'open' || i.status === 'partially_paid') && Number(i.balanceDue) > 0 && (
                    <Button variant="ghost" onClick={() => receive(i)}>Receive</Button>
                  )}
                  {i.status === 'open' && Number(i.amountPaid ?? 0) === 0 && (
                    <>
                      <Button variant="ghost" onClick={() => revertInvoice(i.id)}>Revert to Draft</Button>
                      <Button variant="ghost" onClick={() => voidInvoice(i.id)}>Void</Button>
                    </>
                  )}
                </span>
              </td>
            </tr>
          ))}
          {invoiceRows.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted">{invQ.trim() ? 'No matches.' : 'No invoices yet.'}</td></tr>
          )}
        </Table>
      </div>

      {filesFor && (
        <Modal title="Invoice attachments" onClose={() => setFilesFor(null)}>
          <Attachments entityType="invoice" entityId={filesFor} />
        </Modal>
      )}
    </Page>
  );
}
