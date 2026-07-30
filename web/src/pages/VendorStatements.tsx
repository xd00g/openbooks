import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, date, today, cleanAmount } from '../lib/format';
import { Page, Card, Table, Button, Empty, Banner } from '../components/ui';

/** Vendor statement: full bill + payment history with a running balance, and
 *  a multi-bill "Record payment" flow (pay several open bills in one check/ACH). */
export default function VendorStatements() {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const key = (k: string) => [k, companyId];
  const [vendorId, setVendorId] = useState('');
  const [err, setErr] = useState('');

  const vendors = useQuery({ queryKey: key('vendors'), enabled: !!companyId, queryFn: () => api.get('/expenses/vendors') });
  const accounts = useQuery({ queryKey: key('accounts'), enabled: !!companyId, queryFn: () => api.get('/accounts') });
  const moneyAccounts = (accounts.data ?? []).filter((a: any) => a.subtype === 'bank' || a.subtype === 'credit_card');
  const stmtKey = key(`vendor-statement-${vendorId}`);
  const stmt = useQuery({ queryKey: stmtKey, enabled: !!companyId && !!vendorId, queryFn: () => api.get(`/expenses/vendors/${vendorId}/statement`) });

  const [pay, setPay] = useState<{ paymentDate: string; bankAccountId: string; method: string; reference: string; amounts: Record<string, string> } | null>(null);
  const openPay = () => {
    const amounts: Record<string, string> = {};
    for (const b of stmt.data?.openBills ?? []) amounts[b.id] = b.balanceDue;
    setPay({ paymentDate: today(), bankAccountId: '', method: '', reference: '', amounts });
  };
  const payTotal = Object.values(pay?.amounts ?? {}).reduce((s, v) => s + Number(cleanAmount(v) || '0'), 0);
  const recordPayment = useMutation({
    mutationFn: () => api.post('/expenses/payments', {
      vendorId,
      paymentDate: pay!.paymentDate,
      bankAccountId: pay!.bankAccountId,
      method: pay!.method || undefined,
      reference: pay!.reference || undefined,
      allocations: Object.entries(pay!.amounts).filter(([, v]) => Number(cleanAmount(v)) > 0).map(([billId, v]) => ({ billId, amount: cleanAmount(v) })),
    }),
    onSuccess: () => { setPay(null); qc.invalidateQueries({ queryKey: stmtKey }); qc.invalidateQueries({ queryKey: key('bills') }); },
    onError: (e: any) => setErr(e.message),
  });

  if (!companyId) return <Page title="Vendor Statements"><Empty>Select a company.</Empty></Page>;

  const v = stmt.data?.vendor;

  return (
    <Page title="Vendor Statements">
      <Banner text={err} />
      <Card>
        <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setPay(null); }} className="w-80 rounded-md border border-rule px-2 py-1.5 text-sm">
          <option value="">Select a vendor…</option>
          {(vendors.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
        </select>
      </Card>

      {vendorId && stmt.data && (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-ink">{v.companyName || v.displayName}</div>
                <div className="text-xs text-muted">{[v.email, v.phone].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide text-muted">Balance owed</div>
                <div className="text-2xl font-bold text-ink">{money(stmt.data.balance)}</div>
              </div>
              {stmt.data.openBills.length > 0 && <Button onClick={openPay}>Record payment</Button>}
            </div>
          </Card>

          {pay && (
            <Card title="Record payment">
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-4">
                <label className="text-xs text-muted">Date
                  <input type="date" value={pay.paymentDate} onChange={(e) => setPay({ ...pay, paymentDate: e.target.value })} className="mt-1 block w-full rounded-md border border-rule px-2 py-1" />
                </label>
                <label className="text-xs text-muted sm:col-span-2">Pay from
                  <select value={pay.bankAccountId} onChange={(e) => setPay({ ...pay, bankAccountId: e.target.value })} className="mt-1 block w-full rounded-md border border-rule px-2 py-1">
                    <option value="">Select account…</option>
                    {moneyAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted">Reference #
                  <input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="Check # / confirmation" className="mt-1 block w-full rounded-md border border-rule px-2 py-1" />
                </label>
              </div>

              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">Apply to open bills</div>
                <Table head={['Bill', 'Due', 'Balance', 'Amount to pay']}>
                  {stmt.data.openBills.map((b: any) => (
                    <tr key={b.id}>
                      <td className="px-4 py-2">{b.number || b.id.slice(0, 8)}</td>
                      <td className="px-4 py-2">{b.dueDate ? date(b.dueDate) : '—'}</td>
                      <td className="px-4 py-2 text-right">{money(b.balanceDue)}</td>
                      <td className="px-4 py-2 text-right">
                        <input value={pay.amounts[b.id] ?? ''} onChange={(e) => setPay({ ...pay, amounts: { ...pay.amounts, [b.id]: e.target.value } })} className="w-28 rounded-md border border-rule px-2 py-1 text-right" />
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-ink">Total payment: {money(payTotal)}</div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setPay(null)}>Cancel</Button>
                  <Button onClick={() => recordPayment.mutate()} disabled={!pay.bankAccountId || payTotal <= 0}>Submit payment</Button>
                </div>
              </div>
            </Card>
          )}

          <div className="mt-2">
            <Table head={['Date', 'Ref', 'Type', 'Charge', 'Payment', 'Balance']}>
              {stmt.data.rows.map((r: any) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td className="px-4 py-2">{date(r.date)}</td>
                  <td className="px-4 py-2">{r.ref}</td>
                  <td className="px-4 py-2 capitalize text-muted">{r.kind}</td>
                  <td className="px-4 py-2 text-right">{r.charge ? money(r.charge) : ''}</td>
                  <td className="px-4 py-2 text-right tnum">{r.payment ? money(r.payment) : ''}</td>
                  <td className="px-4 py-2 text-right font-medium">{money(r.balance)}</td>
                </tr>
              ))}
              {stmt.data.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted">No activity for this vendor yet.</td></tr>}
            </Table>
          </div>
        </>
      )}
    </Page>
  );
}
