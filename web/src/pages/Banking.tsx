import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, date, today } from '../lib/format';
import { Page, Card, Table, Button, Empty } from '../components/ui';

export default function Banking() {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const key = (k: string, ...rest: string[]) => [k, companyId, ...rest];
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<string>('');

  const bankAccounts = useQuery({ queryKey: key('bankAccounts'), enabled: !!companyId, queryFn: () => api.get('/banking/accounts') });
  const glAccounts = useQuery({ queryKey: key('accounts'), enabled: !!companyId, queryFn: () => api.get('/accounts') });
  const bankGl = (glAccounts.data ?? []).filter((a: any) => a.subtype === 'bank' || a.subtype === 'credit_card');

  const accountId = selected || bankAccounts.data?.[0]?.id || '';

  const txns = useQuery({
    queryKey: key('bankTxns', accountId),
    enabled: !!companyId && !!accountId,
    queryFn: () => api.get(`/banking/accounts/${accountId}/transactions`),
  });
  const recs = useQuery({
    queryKey: key('recs', accountId),
    enabled: !!companyId && !!accountId,
    queryFn: () => api.get(`/banking/reconciliations?bankAccountId=${accountId}`),
  });
  const active = (recs.data ?? []).find((r: any) => r.status === 'in_progress');
  const summary = useQuery({
    queryKey: key('recSummary', active?.id ?? ''),
    enabled: !!active,
    queryFn: () => api.get(`/banking/reconciliations/${active.id}/summary`),
  });

  const refreshRecon = () => {
    qc.invalidateQueries({ queryKey: key('bankTxns', accountId) });
    qc.invalidateQueries({ queryKey: key('recs', accountId) });
    if (active) qc.invalidateQueries({ queryKey: key('recSummary', active.id) });
  };

  // Link a GL bank account
  const [newBank, setNewBank] = useState({ accountId: '', institution: '', mask: '' });
  const createBank = useMutation({
    mutationFn: () => api.post('/banking/accounts', newBank),
    onSuccess: () => { setNewBank({ accountId: '', institution: '', mask: '' }); qc.invalidateQueries({ queryKey: key('bankAccounts') }); },
    onError: (e: any) => setErr(e.message),
  });

  // CSV import
  const [csv, setCsv] = useState('');
  const importCsv = useMutation({
    mutationFn: () => api.post(`/banking/accounts/${accountId}/import`, { format: 'csv', content: csv }),
    onSuccess: () => { setCsv(''); refreshRecon(); },
    onError: (e: any) => setErr(e.message),
  });

  // Start reconciliation
  const [start, setStart] = useState({ statementDate: today(), beginningBalance: '0', endingBalance: '' });
  const startRecon = useMutation({
    mutationFn: () => api.post('/banking/reconciliations', { bankAccountId: accountId, ...start }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('recs', accountId) }),
    onError: (e: any) => setErr(e.message),
  });

  const toggleClear = (t: any, cleared: boolean) =>
    api.post(`/banking/reconciliations/${active.id}/cleared`, { bankTransactionId: t.id, cleared })
      .then(refreshRecon).catch((e) => setErr(e.message));

  const complete = () =>
    api.post(`/banking/reconciliations/${active.id}/complete`)
      .then(refreshRecon).catch((e) => setErr(e.message));

  if (!companyId) return <Page title="Banking"><Empty>Select a company.</Empty></Page>;

  return (
    <Page title="Banking">
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {(bankAccounts.data ?? []).length === 0 ? (
        <Card title="Link a bank account">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <select value={newBank.accountId} onChange={(e) => setNewBank({ ...newBank, accountId: e.target.value })} className="col-span-2 rounded-md border border-slate-300 px-2 py-1">
              <option value="">GL bank/credit-card account…</option>
              {bankGl.map((a: any) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
            <input value={newBank.institution} onChange={(e) => setNewBank({ ...newBank, institution: e.target.value })} placeholder="Institution" className="rounded-md border border-slate-300 px-2 py-1" />
            <input value={newBank.mask} onChange={(e) => setNewBank({ ...newBank, mask: e.target.value })} placeholder="Last 4" className="rounded-md border border-slate-300 px-2 py-1" />
          </div>
          <div className="mt-3"><Button onClick={() => createBank.mutate()} disabled={!newBank.accountId}>Link account</Button></div>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm text-slate-500">Account:</span>
            <select value={accountId} onChange={(e) => setSelected(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
              {(bankAccounts.data ?? []).map((b: any) => (
                <option key={b.id} value={b.id}>{b.account.code} {b.account.name}{b.mask ? ` ••${b.mask}` : ''}</option>
              ))}
            </select>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Import statement (CSV)">
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                placeholder={'Date,Amount,Description\n2026-07-01,100.00,Deposit\n2026-07-02,-40.00,Coffee'}
                className="h-28 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
              />
              <div className="mt-2"><Button onClick={() => importCsv.mutate()} disabled={!csv.trim()}>Import</Button></div>
            </Card>

            <Card title="Reconciliation">
              {active ? (
                <div className="text-sm">
                  <div className="mb-2 text-slate-600">Statement ending <b>{money(active.endingBalance)}</b> · {date(active.statementDate)}</div>
                  {summary.data && (
                    <dl className="space-y-1">
                      <div className="flex justify-between"><span className="text-slate-500">Beginning</span><span>{money(summary.data.beginningBalance)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Cleared ({summary.data.clearedCount})</span><span>{money(summary.data.clearedNet)}</span></div>
                      <div className="flex justify-between font-medium"><span>Computed ending</span><span>{money(summary.data.computedEnding)}</span></div>
                      <div className={`flex justify-between font-semibold ${summary.data.balanced ? 'text-emerald-600' : 'text-red-600'}`}>
                        <span>Difference</span><span>{money(summary.data.difference)}</span>
                      </div>
                    </dl>
                  )}
                  <div className="mt-3">
                    <Button onClick={complete} disabled={!summary.data?.balanced}>Complete &amp; lock</Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <label className="text-xs text-slate-500">Statement date<input type="date" value={start.statementDate} onChange={(e) => setStart({ ...start, statementDate: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
                  <div />
                  <label className="text-xs text-slate-500">Beginning balance<input value={start.beginningBalance} onChange={(e) => setStart({ ...start, beginningBalance: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
                  <label className="text-xs text-slate-500">Ending balance<input value={start.endingBalance} onChange={(e) => setStart({ ...start, endingBalance: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" /></label>
                  <div className="col-span-2 mt-1"><Button onClick={() => startRecon.mutate()} disabled={!start.endingBalance}>Start reconciliation</Button></div>
                </div>
              )}
            </Card>
          </div>

          <Table head={active ? ['Cleared', 'Date', 'Description', 'Amount', 'Status'] : ['Date', 'Description', 'Amount', 'Status']}>
            {(txns.data ?? []).map((t: any) => {
              const clearedHere = active && t.reconciliationId === active.id;
              const lockedElsewhere = t.reconciliationId && (!active || t.reconciliationId !== active.id);
              return (
                <tr key={t.id}>
                  {active && (
                    <td className="px-4 py-2">
                      <input type="checkbox" checked={!!clearedHere} disabled={!!lockedElsewhere} onChange={(e) => toggleClear(t, e.target.checked)} />
                    </td>
                  )}
                  <td className="px-4 py-2">{date(t.postedDate)}</td>
                  <td className="px-4 py-2">{t.description}</td>
                  <td className={`px-4 py-2 text-right ${Number(t.amount) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{money(t.amount)}</td>
                  <td className="px-4 py-2 capitalize text-slate-500">{t.status}</td>
                </tr>
              );
            })}
            {(txns.data ?? []).length === 0 && (
              <tr><td colSpan={active ? 5 : 4} className="px-4 py-6 text-center text-sm text-slate-400">No transactions. Import a statement above.</td></tr>
            )}
          </Table>
        </>
      )}
    </Page>
  );
}
