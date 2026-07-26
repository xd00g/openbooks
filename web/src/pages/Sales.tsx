import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, today } from '../lib/format';
import { Page, Card, Table, Button, Empty } from '../components/ui';

export default function Sales() {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const key = (k: string) => [k, companyId];
  const [err, setErr] = useState('');

  const customers = useQuery({ queryKey: key('customers'), enabled: !!companyId, queryFn: () => api.get('/sales/customers') });
  const invoices = useQuery({ queryKey: key('invoices'), enabled: !!companyId, queryFn: () => api.get('/sales/invoices') });
  const accounts = useQuery({ queryKey: key('accounts'), enabled: !!companyId, queryFn: () => api.get('/accounts') });
  const incomeAccounts = (accounts.data ?? []).filter((a: any) => a.type === 'income');

  const refresh = () => { qc.invalidateQueries({ queryKey: key('invoices') }); };
  const wrap = (p: Promise<any>) => p.then(refresh).catch((e) => setErr(e.message));

  // new customer
  const [custName, setCustName] = useState('');
  const addCustomer = useMutation({
    mutationFn: () => api.post('/sales/customers', { displayName: custName }),
    onSuccess: () => { setCustName(''); qc.invalidateQueries({ queryKey: key('customers') }); },
    onError: (e: any) => setErr(e.message),
  });

  // new invoice
  const [inv, setInv] = useState({ customerId: '', issueDate: today(), dueDate: '', accountId: '', description: '', quantity: '1', unitPrice: '' });
  const createInvoice = useMutation({
    mutationFn: () => api.post('/sales/invoices', {
      customerId: inv.customerId,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate || undefined,
      lines: [{ accountId: inv.accountId, description: inv.description, quantity: inv.quantity, unitPrice: inv.unitPrice }],
    }),
    onSuccess: () => { setInv({ ...inv, description: '', unitPrice: '' }); refresh(); },
    onError: (e: any) => setErr(e.message),
  });

  const finalize = (id: string) => wrap(api.post(`/sales/invoices/${id}/finalize`));
  const receive = (i: any) => wrap(api.post('/sales/payments', {
    customerId: i.customerId, paymentDate: today(),
    allocations: [{ invoiceId: i.id, amount: String(i.balanceDue) }],
  }));

  if (!companyId) return <Page title="Sales"><Empty>Select a company.</Empty></Page>;

  return (
    <Page title="Sales">
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="New customer">
          <div className="flex gap-2">
            <input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Name" className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <Button onClick={() => addCustomer.mutate()} disabled={!custName}>Add</Button>
          </div>
          <div className="mt-3 text-xs text-slate-500">{(customers.data ?? []).length} customers</div>
        </Card>

        <Card title="New invoice">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <select value={inv.customerId} onChange={(e) => setInv({ ...inv, customerId: e.target.value })} className="col-span-2 rounded-md border border-slate-300 px-2 py-1">
              <option value="">Select customer…</option>
              {(customers.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
            </select>
            <select value={inv.accountId} onChange={(e) => setInv({ ...inv, accountId: e.target.value })} className="col-span-2 rounded-md border border-slate-300 px-2 py-1">
              <option value="">Income account…</option>
              {incomeAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
            <input value={inv.description} onChange={(e) => setInv({ ...inv, description: e.target.value })} placeholder="Description" className="col-span-2 rounded-md border border-slate-300 px-2 py-1" />
            <input value={inv.quantity} onChange={(e) => setInv({ ...inv, quantity: e.target.value })} placeholder="Qty" className="rounded-md border border-slate-300 px-2 py-1" />
            <input value={inv.unitPrice} onChange={(e) => setInv({ ...inv, unitPrice: e.target.value })} placeholder="Unit price" className="rounded-md border border-slate-300 px-2 py-1" />
            <input type="date" value={inv.issueDate} onChange={(e) => setInv({ ...inv, issueDate: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1" />
            <input type="date" value={inv.dueDate} onChange={(e) => setInv({ ...inv, dueDate: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1" />
          </div>
          <div className="mt-3">
            <Button onClick={() => createInvoice.mutate()} disabled={!inv.customerId || !inv.accountId || !inv.unitPrice}>Create draft</Button>
          </div>
        </Card>
      </div>

      <Table head={['Number', 'Status', 'Total', 'Balance', '']}>
        {(invoices.data ?? []).map((i: any) => (
          <tr key={i.id}>
            <td className="px-4 py-2 font-medium">{i.number}</td>
            <td className="px-4 py-2 capitalize text-slate-500">{i.status.replace(/_/g, ' ')}</td>
            <td className="px-4 py-2 text-right">{money(i.total)}</td>
            <td className="px-4 py-2 text-right">{money(i.balanceDue)}</td>
            <td className="px-4 py-2 text-right">
              {i.status === 'draft' && <Button variant="ghost" onClick={() => finalize(i.id)}>Finalize</Button>}
              {(i.status === 'open' || i.status === 'partially_paid') && Number(i.balanceDue) > 0 && (
                <Button variant="ghost" onClick={() => receive(i)}>Receive</Button>
              )}
            </td>
          </tr>
        ))}
        {(invoices.data ?? []).length === 0 && (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No invoices yet.</td></tr>
        )}
      </Table>
    </Page>
  );
}
