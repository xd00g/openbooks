import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, date, today } from '../lib/format';
import { Page, Card, Table, Button, Empty } from '../components/ui';

/** Bank reconciliation: pick a bank account, enter the statement ending balance,
 *  and let the system compare it to cleared activity. Full clearing of individual
 *  transactions activates once the account has bank-feed transactions. */
export default function Reconcile() {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const key = (k: string) => [k, companyId];
  const [bankId, setBankId] = useState('');
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ statementDate: today(), beginningBalance: '0', endingBalance: '' });

  const bankAccounts = useQuery({ queryKey: key('bank-accounts'), enabled: !!companyId, queryFn: () => api.get('/banking/accounts') });
  const recs = useQuery({ queryKey: key(`recs-${bankId}`), enabled: !!companyId && !!bankId, queryFn: () => api.get(`/banking/reconciliations?bankAccountId=${bankId}`) });

  const start = useMutation({
    mutationFn: () => api.post('/banking/reconciliations', { bankAccountId: bankId, ...form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key(`recs-${bankId}`) }); },
    onError: (e: any) => setErr(e.message),
  });

  if (!companyId) return <Page title="Reconcile"><Empty>Select a company.</Empty></Page>;

  const banks = bankAccounts.data ?? [];

  return (
    <Page title="Reconcile">
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {banks.length === 0 ? (
        <Empty>
          No bank accounts yet. Add one under <b>Banking → Integrations &amp; Import</b> (SimpleFIN sync)
          or create a bank/credit-card account and add transactions in <b>Banking → Accounts</b>. Reconciliation
          compares your statement to those transactions.
        </Empty>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-slate-500">Bank account
                <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="mt-1 block w-72 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                  <option value="">Select…</option>
                  {banks.map((b: any) => <option key={b.id} value={b.id}>{b.institution ?? b.account?.name ?? b.id}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-500">Statement date<input type="date" value={form.statementDate} onChange={(e) => setForm({ ...form, statementDate: e.target.value })} className="mt-1 block rounded-md border border-slate-300 px-2 py-1" /></label>
              <label className="text-xs text-slate-500">Beginning balance<input value={form.beginningBalance} onChange={(e) => setForm({ ...form, beginningBalance: e.target.value })} className="mt-1 block w-32 rounded-md border border-slate-300 px-2 py-1 text-right" /></label>
              <label className="text-xs text-slate-500">Ending balance<input value={form.endingBalance} onChange={(e) => setForm({ ...form, endingBalance: e.target.value })} placeholder="0.00" className="mt-1 block w-32 rounded-md border border-slate-300 px-2 py-1 text-right" /></label>
              <Button onClick={() => { setErr(''); start.mutate(); }} disabled={!bankId || !form.endingBalance}>Start reconciliation</Button>
            </div>
          </Card>

          {bankId && (
            <div className="mt-4">
              <Table head={['Statement date', 'Beginning', 'Ending', 'Status']}>
                {(recs.data ?? []).map((r: any) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">{date(r.statementDate)}</td>
                    <td className="px-4 py-2 text-right">{money(r.beginningBalance)}</td>
                    <td className="px-4 py-2 text-right">{money(r.endingBalance)}</td>
                    <td className="px-4 py-2 capitalize text-slate-500">{String(r.status).replace(/_/g, ' ')}</td>
                  </tr>
                ))}
                {recs.data && recs.data.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">No reconciliations yet.</td></tr>}
              </Table>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
